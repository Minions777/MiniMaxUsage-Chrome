// MiniMax Token Monitor - Core Usage Fetch Orchestration
// The main fetchUsage() function that coordinates all API calls, caching,
// history recording, badge update, and notification dispatch.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⚠️⚠️⚠️  M3 API CRITICAL SEMANTIC NOTE  ⚠️⚠️⚠️
//
// The MiniMax M3 API field `current_interval_remaining_percent` is
// SEMANTICALLY REVERSED from what its name implies:
//
//   Field name:  "remaining_percent"
//   Actual meaning: "USED percent" (!)
//
//   Example: remaining_percent = 92  →  92% USED  →  only 8% remaining
//   Example: remaining_percent = 20  →  20% USED  →  80% remaining
//
// This code REVERSES the value so downstream consumers see the true meaning:
//   displayRemainingPercent = 100 - api_remaining_percent
//
// The same reversal applies to `current_weekly_remaining_percent`.
//
// ALL downstream code (badge.js, popup/display.js, etc.) receives the
// CORRECTED value where HIGHER numbers = MORE quota available.
//
// If you see "remaining_percent" in any M3 API response, ALWAYS interpret
// it as "used_percent" unless this reversal has already been applied.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Fetch latest usage data from MiniMax API.
 *
 * Uses fetchJsonWithRetry for all API calls (robust retry + backoff on
// 5xx / network errors, immediate abort on 4xx client errors).
 *
 * @param {object} [options]
 * @param {boolean} [options.force=false] - Skip throttle, force a fresh API call
 * @param {boolean} [options.includeBilling=false] - Fetch & refresh Token billing data
 * @returns {Promise<object>} Usage data object or { error: string }
 */
async function fetchUsage({ force = false, includeBilling = false } = {}) {
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
    // Previously used bare fetch() — now uses fetchJsonWithRetry for
    // robust handling: exponential backoff on 5xx, abort on 4xx.
    const data = await fetchJsonWithRetry(url, {
      'Authorization': `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json',
    }, { timeoutMs: 15000 });

    const statusCode = data.base_resp?.status_code ?? data.code;
    const statusMsg = data.base_resp?.status_msg ?? data.msg;
    if (statusCode !== 0) throw new Error(statusMsg || 'API Error');

    const models = data.model_remains || [];
    if (models.length === 0) throw new Error('无模型数据');

    // ── 2. Select primary model ──
    // Fallback chain: MiniMax-M* → general → first with quota → first
    // (VSCode extension adds 'general' model name as intermediate fallback)
    const mainModel = models.find(m => m.model_name?.startsWith('MiniMax-M'))
      || models.find(m => m.model_name === 'general')
      || models.find(m => m.current_interval_total_count > 0)
      || models[0];

    // ─── 3. 5-hour window quota ─────────────────────────────────────────────

    const intervalTotal = mainModel.current_interval_total_count || 0;
    const intervalUsedCount = mainModel.current_interval_usage_count || 0;
    const intervalRemains = intervalTotal - intervalUsedCount;

    // ⚠️ M3 REVERSAL: remaining_percent field = USED%, not remaining%.
    // True remaining% = 100 - api_remaining_percent.
    const intervalRemainingPct = mainModel.current_interval_remaining_percent;
    const intervalRemainingPercent = (intervalRemainingPct !== undefined && intervalRemainingPct !== null)
      ? Math.round(100 - intervalRemainingPct) // REVERSAL applied here
      : (intervalTotal > 0 ? Math.round((intervalRemains / intervalTotal) * 100) : null);

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

    // ⚠️ M3 REVERSAL: weekly_remaining_percent = USED%, same as interval.
    const weeklyRemainingPct = mainModel.current_weekly_remaining_percent;
    const weeklyRemainingPercent = (weeklyRemainingPct !== undefined && weeklyRemainingPct !== null)
      ? Math.round(100 - weeklyRemainingPct) // REVERSAL applied here
      : (weeklyTotal > 0 ? Math.round((weeklyRemains / weeklyTotal) * 100) : null);

    const weeklyResetMs = mainModel.weekly_remains_time || 0;
    const weeklyResetTime = weeklyResetMs > 0 ? Date.now() + weeklyResetMs : null;

    // ─── 5. Subscription + billing + totalTokens ─────────────────────────────

    let subscription = null;
    let billingRecords = [];
    let totalTokens = 0;

    try {
      const results = await Promise.allSettled([
        fetchSubscription(settings.apiKey, endpoint),
        includeBilling
          ? fetchAndCacheBilling(settings.apiKey, endpoint)
          : loadCachedBilling(),
        // [New] Fetch aggregate lifetime token consumption
        fetchTotalTokens(settings.apiKey, endpoint),
      ]);
      if (results[0].status === 'fulfilled' && results[0].value) subscription = results[0].value;
      if (results[1].status === 'fulfilled') billingRecords = results[1].value;
      if (results[2].status === 'fulfilled') totalTokens = results[2].value || 0;
    } catch {
      // Silent failure — subscription/billing are non-critical
    }

    // Pure functions from lib/utils.js (loaded via importScripts)
    // [New] calculateTokenStats now returns periodTokens (30-day) + totalTokens
    const tokenStats = calculateTokenStats(billingRecords, undefined, totalTokens);

    const usage = {
      // 5-hour window
      intervalUsed: intervalUsedCount,
      intervalRemains,
      intervalTotal,
      intervalRemainingPercent,   // ⚠️ CORRECTED (reversed from API)
      intervalResetTime,
      intervalResetMs,

      // Time window (M3)
      windowStartTime: startTime,  // [Task-6] Used as stable dedup key
      windowEndTime: endTime,

      // Weekly quota
      weeklyUsed: weeklyUsedCount,
      weeklyRemains,
      weeklyTotal,
      weeklyRemainingPercent,      // ⚠️ CORRECTED (reversed from API)
      weeklyResetTime,
      weeklyResetMs,

      // Token consumption stats (from billing records + aggregate)
      tokenStats: {
        yesterday: tokenStats.yesterdayTokens,
        sevenDay: tokenStats.sevenDayTokens,
        month: tokenStats.monthTokens,
        period: tokenStats.periodTokens,   // [New] 近30天
        total: tokenStats.totalTokens,      // [New] 累计
      },

      // Model name (for display)
      modelName: mainModel.model_name || 'unknown',

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
      [STORAGE_KEYS.LAST_FETCH_AT]: Date.now(),
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