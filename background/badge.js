// MiniMax Token Monitor - Badge & Desktop Notification
// Extension icon badge text/color update and low-usage desktop notifications.
//
// ⚠️ M3 API CRITICAL SEMANTIC NOTE (applies to all functions in this file):
// `current_interval_remaining_percent` means "USED %" not "remaining %".
// The reversal + clamp is applied in background/core.js via correctRemainingPct
// (lib/utils.js), so by the time these functions receive
// usage.intervalRemainingPercent it is a true 0..100 "remaining%" (higher =
// more quota available). Badge color + notification logic operate on it.

/**
 * Update extension icon badge with remaining percentage and color.
 * Green (≥60%), Yellow (≥30%), Red (<30%) — threshold from COLOR_THRESHOLDS,
 * hex from badgeColorHex (both in lib/utils.js, single source of truth).
 */
function updateBadge(usage) {
  if (!usage || usage.error) {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#ff7675' });
    return;
  }
  // core.js guarantees a 0..100 integer here; ?? 0 is belt-and-suspenders for
  // any stale cached usage object persisted before the correction existed.
  const remainingPct = usage.intervalRemainingPercent ?? 0;
  chrome.action.setBadgeText({ text: remainingPct + '%' });
  chrome.action.setBadgeBackgroundColor({ color: badgeColorHex(remainingPct) });
}

/**
 * Send desktop notification when remaining quota drops below threshold.
 * Same time window only notifies once. The dedup key uses dedupWindowKey(usage)
 * → prefers the stable `windowStartTime` (absolute API timestamp), NOT
 * `intervalResetTime` (which = Date.now()+remains_ms and drifts per fetch, so
 * keying on it caused repeat notifications for the same 5h window).
 *
 * Note: chrome.notifications requires the "notifications" permission declared
 * in manifest.json. If permission is denied at runtime, this silently fails.
 */
async function maybeNotifyLowUsage(usage) {
  try {
    const { [STORAGE_KEYS.NOTIFICATIONS_ENABLED]: notifEnabled,
            [STORAGE_KEYS.NOTIFY_THRESHOLD]: threshold,
            [STORAGE_KEYS.NOTIFIED_WINDOW_KEYS]: notifiedRaw = [] } =
      await chrome.storage.sync.get([
        STORAGE_KEYS.NOTIFICATIONS_ENABLED,
        STORAGE_KEYS.NOTIFY_THRESHOLD,
        STORAGE_KEYS.NOTIFIED_WINDOW_KEYS,
      ]);

    // Default: notifications enabled
    if (notifEnabled === false) return;

    const remainingPct = usage.intervalRemainingPercent ?? 0;
    const limit = typeof threshold === 'number' ? threshold : DEFAULT_NOTIFY_THRESHOLD;
    if (remainingPct > limit) return; // Still above threshold — no notification

    // Dedup: same window only notifies once (stable key, see header)
    const windowKey = dedupWindowKey(usage);
    const notified = Array.isArray(notifiedRaw) ? notifiedRaw : [];
    if (notified.includes(windowKey)) return;

    await chrome.notifications.create(`low-usage-${windowKey}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: '用量提醒',
      message: `5 小时配额剩余 ${remainingPct}%，请注意用量`,
      priority: 2,
    });

    // Track notified window keys (keep most recent N to limit storage)
    const updatedNotified = [...notified, windowKey].slice(-NOTIFIED_KEYS_LIMIT);
    await chrome.storage.sync.set({ [STORAGE_KEYS.NOTIFIED_WINDOW_KEYS]: updatedNotified });
  } catch (e) {
    // notifications permission denied etc. — silent failure, don't break main flow
    await addLog('warn', `通知发送失败: ${e.message}`);
  }
}
