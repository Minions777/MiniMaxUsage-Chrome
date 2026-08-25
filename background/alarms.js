// MiniMax Token Monitor - Auto-refresh Scheduling
// chrome.alarms-based periodic refresh (MV3 persistent, minimum 1-minute interval).

/**
 * Start auto-refresh alarm based on current settings.
 * MV3 chrome.alarms doesn't support sub-minute intervals, so we round up.
 * Clears any existing alarm first, so disabling auto-refresh (autoRefreshEnabled
 * === false) both clears the prior alarm and returns without recreating it.
 */
async function startAutoRefresh() {
  await chrome.alarms.clear('autoRefresh');
  const settings = await getSettings();
  if (!settings.autoRefreshEnabled || !settings.apiKey) return;

  const periodInMinutes = Math.max(1, Math.round(settings.autoRefreshInterval / 60));
  chrome.alarms.create('autoRefresh', { periodInMinutes });
}
