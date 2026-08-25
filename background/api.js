// MiniMax Token Monitor - API Network Operations
// Fetch with retry, subscription, and billing record retrieval.

/**
 * Generic JSON GET with configurable retry.
 * Retry only on network errors / 5xx / 408 / 429 (decided by shouldRetryStatus);
 * other 4xx (bad key, bad params) aborts immediately since they won't succeed
 * on retry.
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

      // Retry decision delegated to pure shouldRetryStatus (lib/utils.js)
      if (!shouldRetryStatus(response.status)) {
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
 * Cached for SUBSCRIPTION_CACHE_TTL_MS (plan expiry changes at most daily).
 * Returns null on failure — non-critical data. Logs a warn on failure for
 * diagnostic parity with fetchTotalTokens/fetchAllBillingRecords.
 */
async function fetchSubscription(apiKey, endpoint) {
  const { [SUBSCRIPTION_CACHE_KEY]: cache } =
    await chrome.storage.local.get(SUBSCRIPTION_CACHE_KEY);
  if (cache && (Date.now() - (cache.fetchedAt || 0)) <= SUBSCRIPTION_CACHE_TTL_MS) {
    return cache.value; // may be null = legitimately no subscription
  }
  try {
    const url = endpoint.baseURL + endpoint.subscriptionPath;
    const data = await fetchJsonWithRetry(url, {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    });
    const value = data.current_subscribe || null;
    await chrome.storage.local.set({ [SUBSCRIPTION_CACHE_KEY]: { value, fetchedAt: Date.now() } });
    return value;
  } catch (error) {
    await addLog('warn', `订阅信息获取失败 (${error.message})，返回 null`);
    return null; // do NOT cache failures — next cycle retries
  }
}

/**
 * Fetch all billing records (paginated, max BILLING_WINDOW_DAYS days).
 * On partial failure, returns already-collected records (partial data > no data).
 *
 * Assumes the API returns records NEWEST-FIRST (the MiniMax charge endpoint's
 * default). Keeps only in-window records and stops paging once a page contains
 * any out-of-window record — an early-stop optimization that is correct under
 * newest-first ordering. If the API ever returns oldest-first, this would
 * return [] for users with >30 days of history (the early stop would fire on
 * page 1 before reaching recent records); that ordering is not currently
 * handled because it would require fetching all pages unbounded.
 *
 * Previously this `return`'d mid-loop on the first old record without pushing
 * it, which could drop valid recent records that appeared after an old one on a
 * mixed page (newest-first) — now fixed via the push-then-skip continue loop.
 */
async function fetchAllBillingRecords(apiKey, endpoint) {
  const allRecords = [];
  let page = 1;
  const limit = BILLING_PAGE_SIZE;
  const maxPages = BILLING_MAX_PAGES; // Safety limit to prevent infinite loops
  const minStartTime = Date.now() - BILLING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
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

    // Keep only in-window records; detect any out-of-window record on this page.
    let foundOld = false;
    for (const r of records) {
      const ts = r.created_at * 1000;
      if (ts < minStartTime) { foundOld = true; continue; }
      allRecords.push(r);
    }

    // Stop once we hit out-of-window records or a short (last) page.
    if (foundOld || records.length < limit) break;
    page++;
  }

  return allRecords;
}

/**
 * Fetch aggregate lifetime token consumption (server-side sum, no pagination).
 * Uses the billing endpoint with `aggregate=true` parameter.
 * Cached for TOTAL_TOKENS_CACHE_TTL_MS (changes slowly). Returns total consumed
 * tokens across all time.
 */
async function fetchTotalTokens(apiKey, endpoint) {
  const { [TOTAL_TOKENS_CACHE_KEY]: cache } =
    await chrome.storage.local.get(TOTAL_TOKENS_CACHE_KEY);
  if (cache && typeof cache.value === 'number'
      && (Date.now() - (cache.fetchedAt || 0)) <= TOTAL_TOKENS_CACHE_TTL_MS) {
    return cache.value;
  }
  const url = `${endpoint.baseURL}${endpoint.billingPath}?page=1&limit=1&aggregate=true`;
  try {
    const data = await fetchJsonWithRetry(url, {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    });
    const statusCode = data.base_resp?.status_code ?? data.code;
    const statusMsg = data.base_resp?.status_msg ?? data.msg;
    if (statusCode !== undefined && statusCode !== 0) throw new Error(statusMsg || 'API Error');
    const value = Number(data.consume_token_sum || 0);
    await chrome.storage.local.set({ [TOTAL_TOKENS_CACHE_KEY]: { value, fetchedAt: Date.now() } });
    return value;
  } catch (e) {
    // Non-critical — return 0 on failure (partial data > no data)
    await addLog('warn', `累计消耗获取失败 (${e.message})，返回 0`);
    return 0; // do NOT cache failures
  }
}
