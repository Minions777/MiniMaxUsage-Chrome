// MiniMax Token Monitor - Core Usage Fetch Orchestration
// The main fetchUsage() function that coordinates all API calls, caching,
// history recording, badge update, and notification dispatch.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⚠️⚠️⚠️  M3 API CRITICAL SEMANTIC NOTE  ⚠️⚠️⚠️
//
// The MiniMax M3 API field `current_interval_remaining_percent` is
// SEMANTICALLY REVERSED from what its name implies: it actually means
// "USED percent". The reversal (100 - value) + clamp to [0,100] + count-based
// fallback is applied here via correctRemainingPct() (lib/utils.js), which is
// the single source of truth for that logic. Downstream consumers (badge.js,
// popup/display.js) receive a guaranteed 0..100 integer and must NOT re-derive
// it. The same applies to `current_weekly_remaining_percent`.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// In-flight guard: while a fetch is running, concurrent NON-force callers share
// its promise instead of firing a duplicate request. This prevents the
// SW-restart init IIFE and the auto-refresh alarm handler from double-fetching
// when both fire on the same SW wake. Cleared in finally.
let fetchInFlight = null;

/**
 * Fetch latest usage data from MiniMax API.
 *
 * Uses fetchJsonWithRetry for all API calls (robust retry + backoff on 5xx /
 * network errors, immediate abort on 4xx client errors via shouldRetryStatus).
 *
 * @param {object} [options]
 * @param {boolean} [options.force=false] - Skip throttle, force a fresh API call.
 *   force callers always run their own fetch (never share an in-flight one) so a
 *   manual refresh bypasses the throttle even if an alarm fetch is mid-flight.
 * @param {boolean} [options.includeBilling=false] - Fetch & refresh Token billing data
 * @returns {Promise<object>} Usage data object or { error: string }
 */
function fetchUsage({ force = false, includeBilling = false } = {}) {
  // Non-force callers share any in-flight fetch (dedup concurrent alarms/init).
  if (!force && fetchInFlight) return fetchInFlight;
  const promise = doFetchUsage({ force, includeBilling });
  fetchInFlight = promise;
  return promise.finally(() => {
    if (fetchInFlight === promise) fetchInFlight = null;
  });
}

async function doFetchUsage({ force = false, includeBilling = false } = {}) {
  const settings = await getSettings();
  if (!settings.apiKey) return { error: 'NO_API_KEY' };

  // Throttle: return cached data if within throttle window (unless force=true)
  if (!force) {
    const cached = await getCachedUsage();
    const throttleResult = await applyUsageThrottle(cached);
    if (throttleResult) return throttleResult;
  }

  const endpoint = ENDPOINTS[settings.endpoint];
  const url = endpoint.baseURL + endpoint.remainsPath;

  try {
    // ── 1. Fetch quota remains (with retry) ──
    const data = await fetchJsonWithRetry(url, {
      'Authorization': `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json',
    }, { timeoutMs: 15000 });

    const statusCode = data.base_resp?.status_code ?? data.code;
    const statusMsg = data.base_resp?.status_msg ?? data.msg;
    if (statusCode !== 0) throw new Error(statusMsg || 'API Error');

    const models = data.model_remains || [];
    if (models.length === 0) throw new Error('无模型数据');

    // ── 2. Select primary model (pure selectMainModel from lib/utils.js) ──
    const mainModel = selectMainModel(models);
    if (!mainModel) throw new Error('无模型数据');

    // ─── 3. 5-hour window quota ─────────────────────────────────────────────

    const intervalTotal = mainModel.current_interval_total_count || 0;
    const intervalUsedCount = mainModel.current_interval_usage_count || 0;
    const intervalRemains = intervalTotal - intervalUsedCount;

    // ⚠️ M3 reversal + clamp + fallback — single source: correctRemainingPct
    const intervalRemainingPercent = correctRemainingPct(
      mainModel.current_interval_remaining_percent, intervalTotal, intervalUsedCount);

    // M3: remains_time is relative (ms) → compute absolute reset timestamp
    const intervalResetMs = mainModel.remains_time || 0;
    const intervalResetTime = intervalResetMs > 0 ? Date.now() + intervalResetMs : null;

    // M3: time window boundaries (absolute timestamps from API)
    const startTime = mainModel.start_time || null;
    const endTime = mainModel.end_time || null;

    // ─── 4. Weekly quota ─────────────────────────────────────────────────────

    const weeklyTotal = mainModel.current_weekly_total_count || 0;
    const weeklyUsedCount = mainModel.current_weekly_usage_count || 0;
    const weeklyRemains = weeklyTotal - weeklyUsedCount;

    // ⚠️ M3 reversal + clamp + fallback (same as interval)
    const weeklyRemainingPercent = correctRemainingPct(
      mainModel.current_weekly_remaining_percent, weeklyTotal, weeklyUsedCount);

    const weeklyResetMs = mainModel.weekly_remains_time || 0;
    const weeklyResetTime = weeklyResetMs > 0 ? Date.now() + weeklyResetMs : null;

    // ─── 5. Subscription + billing + totalTokens ─────────────────────────────
    // Each fetcher catches/logs its own failures and returns a safe default
    // (null / [] / 0), so Promise.allSettled never rejects and a dead outer
    // try/catch is not needed. Rejected results (defensive) leave defaults.

    let subscription = null;
    let billingRecords = [];
    let totalTokens = 0;

    const results = await Promise.allSettled([
      fetchSubscription(settings.apiKey, endpoint),
      includeBilling
        ? fetchAndCacheBilling(settings.apiKey, endpoint)
        : loadCachedBilling(),
      fetchTotalTokens(settings.apiKey, endpoint),
    ]);
    if (results[0].status === 'fulfilled' && results[0].value) subscription = results[0].value;
    if (results[1].status === 'fulfilled') billingRecords = results[1].value;
    if (results[2].status === 'fulfilled') totalTokens = results[2].value || 0;

    // Pure function from lib/utils.js (loaded via importScripts)
    const tokenStats = calculateTokenStats(billingRecords, undefined, totalTokens);

    const fetchedAt = Date.now();
    const usage = {
      // 5-hour window
      intervalUsed: intervalUsedCount,
      intervalRemains,
      intervalTotal,
      intervalRemainingPercent,   // ⚠️ CORRECTED (reversed + clamped, 0..100)
      intervalResetTime,
      intervalResetMs,

      // Time window (M3)
      windowStartTime: startTime,  // [Task-6] stable dedup key source
      windowEndTime: endTime,

      // Weekly quota
      weeklyUsed: weeklyUsedCount,
      weeklyRemains,
      weeklyTotal,
      weeklyRemainingPercent,      // ⚠️ CORRECTED (reversed + clamped, 0..100)
      weeklyResetTime,
      weeklyResetMs,

      // Token consumption stats (from billing records + aggregate)
      tokenStats: {
        yesterday: tokenStats.yesterdayTokens,
        sevenDay: tokenStats.sevenDayTokens,
        month: tokenStats.monthTokens,
        period: tokenStats.periodTokens,   // 近30天
        total: tokenStats.totalTokens,      // 累计
      },

      // Model name (for display)
      modelName: mainModel.model_name || 'unknown',

      // When this snapshot was fetched (for the popup footer — previously the
      // popup showed its own open-time, which was misleading)
      fetchedAt,

      // Subscription expiry
      subscription: subscription ? {
        endTime: subscription.current_subscribe_end_time,
        creditReloadTime: subscription.current_credit_reload_time,
        daysUntilEnd: daysUntil(new Date(subscription.current_subscribe_end_time)),
      } : null,

      // Formatted reset countdown strings (from lib/utils.js)
      intervalResetTimeStr: formatResetCountdownMs(intervalResetMs),
      weeklyResetTimeStr: formatResetCountdownMs(weeklyResetMs),
    };

    // Persist usage data and fetch timestamp
    await chrome.storage.local.set({
      [STORAGE_KEYS.LAST_USAGE]: usage,
      [STORAGE_KEYS.LAST_FETCH_AT]: fetchedAt,
    });

    // Record in history (dedup handled by addHistoryRecord)
    await addHistoryRecord(usage);
    await addLog('success', `获取用量成功 — 剩余 ${intervalRemains} / 总计 ${intervalTotal} (${intervalRemainingPercent ?? '--'}%)`);
    updateBadge(usage);
    await maybeNotifyLowUsage(usage);

    return usage;
  } catch (error) {
    await addLog('error', `获取用量失败: ${error.message}`);
    return { error: error.message || 'NETWORK_ERROR' };
  }
}
