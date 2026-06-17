// MiniMax Token Monitor - API Network Operations
// Fetch with retry, subscription, and billing record retrieval.

/**
 * Generic JSON GET with configurable retry.
 * Retry only on network errors / 5xx; 4xx (except 408/429) aborts immediately
 * since client errors (bad key, bad params) won't succeed on retry.
 *
 * @param {string} url - Full URL to fetch
 * @param {object} headers - Request headers
 * @param {object} [options] - { timeoutMs, maxAttempts, backoffMs }
 * @returns {Promise<object>} Parsed JSON response
 */
async function fetchJsonWithRetry(url, headers, { timeoutMs = 10000, maxAttempts = 3, backoffMs = 500 } = {}) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.ok) return await response.json();

      // 4xx (except 408 Request Timeout / 429 Too Many Requests) — no retry
      if (response.status >= 400 && response.status < 500
          && response.status !== 408 && response.status !== 429) {
        lastErr = new Error(`HTTP ${response.status}`);
        break; // Client error — retrying won't help
      }
      lastErr = new Error(`HTTP ${response.status}`);
    } catch (e) {
      clearTimeout(timeoutId);
      lastErr = e;
    }
    // Exponential backoff: 500ms, 1000ms, 2000ms...
    if (attempt < maxAttempts) {
      await new Promise(r => setTimeout(r, backoffMs * Math.pow(2, attempt - 1)));
    }
  }
  throw lastErr;
}

/**
 * Fetch subscription info (plan expiry date, credit reload time).
 * Returns null on failure — non-critical data.
 */
async function fetchSubscription(apiKey, endpoint) {
  try {
    const url = endpoint.baseURL + endpoint.subscriptionPath;
    const data = await fetchJsonWithRetry(url, {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    });
    return data.current_subscribe || null;
  } catch (error) {
    return null;
  }
}

/**
 * Fetch all billing records (paginated, max 30 days).
 * On partial failure, returns already-collected records (partial data > no data).
 */
async function fetchAllBillingRecords(apiKey, endpoint) {
  const allRecords = [];
  let page = 1;
  const limit = 100;
  const maxPages = 30; // Safety limit to prevent infinite loops
  const minStartTime = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  while (page <= maxPages) {
    const url = `${endpoint.baseURL}${endpoint.billingPath}?page=${page}&limit=${limit}&aggregate=false`;
    let data;
    try {
      data = await fetchJsonWithRetry(url, headers);
    } catch (e) {
      // Already retried 3 times — preserve collected records
      await addLog('warn', `账单分页 ${page} 获取失败 (${e.message})，返回已有 ${allRecords.length} 条`);
      break;
    }

    const records = data.charge_records || [];
    if (records.length === 0) break;

    for (const r of records) {
      const ts = r.created_at * 1000;
      if (minStartTime && ts < minStartTime) return allRecords; // Past 30 days — stop
      allRecords.push(r);
    }

    if (records.length < limit) break; // Last page
    page++;
  }

  return allRecords;
}

/**
 * Fetch aggregate lifetime token consumption (server-side sum, no pagination).
 * Uses the billing endpoint with `aggregate=true` parameter.
 * Returns total consumed tokens across all time.
 */
async function fetchTotalTokens(apiKey, endpoint) {
  const url = `${endpoint.baseURL}${endpoint.billingPath}?page=1&limit=1&aggregate=true`;
  try {
    const data = await fetchJsonWithRetry(url, {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    });
    const statusCode = data.base_resp?.status_code ?? data.code;
    const statusMsg = data.base_resp?.status_msg ?? data.msg;
    if (statusCode !== undefined && statusCode !== 0) throw new Error(statusMsg || 'API Error');
    return Number(data.consume_token_sum || 0);
  } catch (e) {
    // Non-critical — return 0 on failure (partial data > no data)
    await addLog('warn', `累计消耗获取失败 (${e.message})，返回 0`);
    return 0;
  }
}