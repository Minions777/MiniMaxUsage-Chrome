// MiniMax Token Monitor - Badge & Desktop Notification
// Extension icon badge text/color update and low-usage desktop notifications.
//
// ⚠️ M3 API CRITICAL SEMANTIC NOTE (applies to all functions in this file):
//
// The MiniMax M3 API field `current_interval_remaining_percent` is
// SEMANTICALLY REVERSED: despite its name suggesting "remaining percent",
// it actually represents "USED percent". For example:
//   remaining_percent = 92  →  92% USED  →  only 8% truly remaining
//   remaining_percent = 20  →  20% USED  →  80% truly remaining
//
// This reversal is corrected in background/core.js:
//   displayRemainingPercent = 100 - api_remaining_percent
//
// By the time these functions receive `usage.intervalRemainingPercent`, it
// already represents the TRUE "remaining%" (higher = more quota available).
// Badge and notification logic operate on the corrected value.

/**
 * Update extension icon badge with remaining percentage and color.
 * Green (≥60%), Yellow (≥30%), Red (<30%) — based on CORRECTED remaining%.
 */
function updateBadge(usage) {
  if (!usage || usage.error) {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#ff7675' });
  } else {
    const remainingPct = usage.intervalRemainingPercent ?? (
      usage.intervalTotal > 0 ? Math.round((usage.intervalRemains / usage.intervalTotal) * 100) : 0
    );
    chrome.action.setBadgeText({ text: remainingPct + '%' });

    if (remainingPct >= 60) {
      chrome.action.setBadgeBackgroundColor({ color: '#00d09c' });
    } else if (remainingPct >= 30) {
      chrome.action.setBadgeBackgroundColor({ color: '#fdcb6e' });
    } else {
      chrome.action.setBadgeBackgroundColor({ color: '#ff7675' });
    }
  }
}

/**
 * Send desktop notification when remaining quota drops below threshold.
 * Same time window only notifies once (keyed by intervalResetTime) to avoid
 * notification spam during auto-refresh.
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

    const remainingPct = usage.intervalRemainingPercent ?? (
      usage.intervalTotal > 0 ? Math.round((usage.intervalRemains / usage.intervalTotal) * 100) : 0
    );
    const limit = typeof threshold === 'number' ? threshold : DEFAULT_NOTIFY_THRESHOLD;
    if (remainingPct > limit) return; // Still above threshold — no notification

    // Dedup: same window (intervalResetTime) only notifies once
    const windowKey = usage.intervalResetTime || String(usage.intervalRemains);
    const notified = Array.isArray(notifiedRaw) ? notifiedRaw : [];
    if (notified.includes(windowKey)) return;

    await chrome.notifications.create(`low-usage-${windowKey}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: '用量提醒', // 用量提醒
      message: `5 小时配额剩余 ${remainingPct}%，请注意用量`, // 5 小时配额剩余 X%，请注意用量
      priority: 2,
    });

    // Track notified window keys (keep most recent N to limit storage)
    const updatedNotified = [...notified, windowKey].slice(-NOTIFIED_KEYS_LIMIT);
    await chrome.storage.sync.set({ [STORAGE_KEYS.NOTIFIED_WINDOW_KEYS]: updatedNotified });
  } catch (e) {
    // notifications permission denied etc. — silent failure, don't break main flow
    await addLog('warn', `通知发送失败: ${e.message}`); // 通知发送失败
  }
}