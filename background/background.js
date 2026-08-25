// MiniMax Token Monitor - Background Service Worker Entry Point
//
// Loads all modules via importScripts and registers MV3 event listeners.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⚠️ MV3 REQUIREMENT:
// importScripts() and chrome.* event listener registration MUST happen at
// the top-level scope (not inside async functions or callbacks). The SW may
// be terminated at any time; only top-level registrations are persisted.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Load shared utilities first (formatNumber, daysUntil, calculateTokenStats,
// correctRemainingPct, selectMainModel, dedupWindowKey, shouldIncludeBilling,
// shouldRetryStatus, badgeColorHex, pruneLogs, pruneHistoryRecords, etc.)
// then background modules in dependency order:
//   config → storage → api → billing → badge → alarms → core
try {
  importScripts(
    '../lib/utils.js',
    'config.js',
    'storage.js',
    'api.js',
    'billing.js',
    'badge.js',
    'alarms.js',
    'core.js'
  );
} catch (e) {
  console.warn('Failed to importScripts:', e);
}

// ─── Event listeners (top-level registration for MV3) ────────────────────

/**
 * Auto-refresh alarm handler.
 *
 * [Task-7] IMPROVEMENT: Automatically includes billing refresh when the
 * billing cache is expired (≈every 30 min). The freshness decision is delegated
 * to pure shouldIncludeBilling() (lib/utils.js) so this handler does not reach
 * into billing.js's private cache shape. fetchUsage's in-flight guard dedupes
 * concurrent calls from the SW-restart init IIFE below.
 */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'autoRefresh') {
    const { [BILLING_CACHE_KEY]: billingCache } =
      await chrome.storage.local.get(BILLING_CACHE_KEY);
    const includeBilling = shouldIncludeBilling(billingCache, BILLING_CACHE_TTL_MS);

    await fetchUsage({ includeBilling });
    chrome.runtime.sendMessage({ type: 'USAGE_UPDATED' }).catch(() => {});
  }
});

/**
 * Message handler (popup → background communication).
 * Returns true for async sendResponse (keeps message channel open).
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'GET_USAGE':
      getCachedUsage().then(sendResponse);
      return true;
    case 'GET_SETTINGS':
      getSettings().then(sendResponse);
      return true;
    case 'SAVE_SETTINGS':
      saveSettings(message.settings).then(async () => {
        await startAutoRefresh();
        sendResponse({ success: true });
      });
      return true;
    case 'GET_HISTORY':
      getHistory().then(sendResponse);
      return true;
    case 'CLEAR_HISTORY':
      chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: [] }).then(() => sendResponse({ success: true }));
      return true;
    case 'GET_LOGS':
      getLogs().then(sendResponse);
      return true;
    case 'CLEAR_LOGS':
      chrome.storage.local.set({ [STORAGE_KEYS.LOGS]: [] }).then(() => sendResponse({ success: true }));
      return true;
    case 'START_AUTO_REFRESH':
      startAutoRefresh().then(sendResponse);
      return true;
    case 'REFRESH_USAGE':
      (async () => {
        try {
          // force=true bypasses throttle AND runs its own fetch (does not share
          // an in-flight non-force fetch), so a manual refresh always hits the API.
          const result = await fetchUsage({ force: true, includeBilling: true });
          sendResponse(result);
        } catch (e) {
          sendResponse({ error: e.message || 'NETWORK_ERROR' });
        }
      })();
      return true;
  }
});

// ─── Initialization ──────────────────────────────────────────────────────────

/**
 * [Task-7] IMPROVED: On SW restart with cached data, if billing cache is
 * expired/empty, proactively fetch billing data so Token stats are available
 * when the user opens the popup (instead of showing stale/empty data).
 * Non-blocking; fetchUsage's in-flight guard dedupes with any concurrent alarm.
 */
(async () => {
  const settings = await getSettings();
  if (!settings.apiKey) return;

  const cached = await getCachedUsage();
  if (!cached) {
    // First install: fetch everything including billing
    await fetchUsage({ includeBilling: true });
  } else {
    // SW restart with cache: proactively refresh billing if expired
    const billingRecords = await loadCachedBilling();
    if (billingRecords.length === 0) {
      // Billing cache empty/expired — non-blocking proactive fetch
      fetchUsage({ includeBilling: true }).catch(() => {});
    }
  }
  await startAutoRefresh();
})();
