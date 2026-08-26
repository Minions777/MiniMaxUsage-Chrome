// MiniMax Token Monitor - Storage Operations
// All chrome.storage.local / chrome.storage.sync read/write operations.

// ─── Settings ────────────────────────────────────────────────────────────────

async function getSettings() {
  const [syncResult, localResult] = await Promise.all([
    chrome.storage.sync.get([
      STORAGE_KEYS.ENDPOINT,
      STORAGE_KEYS.AUTO_REFRESH_INTERVAL,
      STORAGE_KEYS.AUTO_REFRESH_ENABLED,
      STORAGE_KEYS.NOTIFICATIONS_ENABLED,
      STORAGE_KEYS.NOTIFY_THRESHOLD,
    ]),
    chrome.storage.local.get([STORAGE_KEYS.API_KEY]),
  ]);
  return {
    apiKey: localResult[STORAGE_KEYS.API_KEY] || '',
    endpoint: syncResult[STORAGE_KEYS.ENDPOINT] || 'china',
    autoRefreshInterval: syncResult[STORAGE_KEYS.AUTO_REFRESH_INTERVAL] || 60,
    autoRefreshEnabled: syncResult[STORAGE_KEYS.AUTO_REFRESH_ENABLED] !== false,
    notificationsEnabled: syncResult[STORAGE_KEYS.NOTIFICATIONS_ENABLED] !== false,
    notifyThreshold: syncResult[STORAGE_KEYS.NOTIFY_THRESHOLD] ?? DEFAULT_NOTIFY_THRESHOLD,
  };
}

async function saveSettings(settings) {
  await Promise.all([
    chrome.storage.sync.set({
      [STORAGE_KEYS.ENDPOINT]: settings.endpoint || 'china',
      [STORAGE_KEYS.AUTO_REFRESH_INTERVAL]: settings.autoRefreshInterval || 60,
      [STORAGE_KEYS.AUTO_REFRESH_ENABLED]: settings.autoRefreshEnabled !== false,
      [STORAGE_KEYS.NOTIFICATIONS_ENABLED]: settings.notificationsEnabled !== false,
      [STORAGE_KEYS.NOTIFY_THRESHOLD]: settings.notifyThreshold ?? DEFAULT_NOTIFY_THRESHOLD,
    }),
    chrome.storage.local.set({
      [STORAGE_KEYS.API_KEY]: settings.apiKey || '',
    }),
  ]);
}

// ─── History ─────────────────────────────────────────────────────────────────

async function getHistory() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.HISTORY);
  return result[STORAGE_KEYS.HISTORY] || [];
}

// Prune + cap history (delegates to pure pruneHistoryRecords from lib/utils.js).
async function saveHistory(history) {
  const limited = pruneHistoryRecords(history, Date.now(), HISTORY_RETENTION_DAYS, HISTORY_MAX_PER_DAY);
  await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: limited });
  return limited;
}

/**
 * Add a history record for the current usage snapshot.
 *
 * [Task-6] IMPROVED DEDUP STRATEGY:
 * Uses dedupWindowKey(usage) → prefers `windowStartTime` (absolute start of
 * the 5h window, bit-stable across fetches) over `intervalResetTime` (which
 * = Date.now() + remains_time and drifts per fetch). The dedup key selection
 * lives in lib/utils.js so tests exercise the real function.
 *
 * Batched: one read (LAST_WINDOW_KEY + HISTORY) and one write (HISTORY +
 * LAST_WINDOW_KEY) instead of 4 round-trips. A dedicated key (LAST_WINDOW_KEY)
 * tracks the last recorded window, decoupled from LAST_USAGE.
 *
 * Serialized via historyWriteQueue with a re-check inside the critical section:
 * two concurrent fetchUsage calls (e.g. a force refresh overlapping an alarm
 * fetch) landing on the same new window can't both pass the dedup check and
 * double-insert / lost-write, because the second re-reads LAST_WINDOW_KEY after
 * the first has written it.
 */
let historyWriteQueue = Promise.resolve();
function addHistoryRecord(usage) {
  historyWriteQueue = historyWriteQueue
    .then(async () => {
      const windowKey = dedupWindowKey(usage);

      // Re-read inside the critical section: a prior queued write may have
      // just landed this same windowKey, in which case skip.
      const { [STORAGE_KEYS.LAST_WINDOW_KEY]: lastKey,
              [STORAGE_KEYS.HISTORY]: historyRaw } =
        await chrome.storage.local.get([STORAGE_KEYS.LAST_WINDOW_KEY, STORAGE_KEYS.HISTORY]);

      if (lastKey === windowKey) return; // Same window already recorded — skip

      const history = Array.isArray(historyRaw) ? historyRaw : [];
      history.unshift({
        id: Date.now().toString(),
        timestamp: Date.now(),
        used: usage.intervalUsed,
        remains: usage.intervalRemains,
        total: usage.intervalTotal,
      });

      // Batched write: history + dedup key in one round-trip.
      const limited = pruneHistoryRecords(history, Date.now(), HISTORY_RETENTION_DAYS, HISTORY_MAX_PER_DAY);
      await chrome.storage.local.set({
        [STORAGE_KEYS.HISTORY]: limited,
        [STORAGE_KEYS.LAST_WINDOW_KEY]: windowKey,
      });
    })
    .catch(() => {}); // never let one failed write break the queue for subsequent records
  return historyWriteQueue;
}

// ─── Logs ────────────────────────────────────────────────────────────────────

async function getLogs() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.LOGS);
  return result[STORAGE_KEYS.LOGS] || [];
}

async function saveLogs(logs) {
  const pruned = pruneLogs(logs, Date.now(), LOG_RETENTION_DAYS, LOG_MAX);
  await chrome.storage.local.set({ [STORAGE_KEYS.LOGS]: pruned });
  return pruned;
}

/**
 * Append a log entry. Serialized via an in-SW promise queue so concurrent
 * addLog calls (e.g. billing-page failure + totalTokens failure racing inside
 * one fetchUsage via Promise.allSettled) do not lost-write each other.
 * pruneLogs keeps the NEWEST LOG_MAX entries (input is newest-first via unshift).
 */
let logWriteQueue = Promise.resolve();
function addLog(type, message) {
  logWriteQueue = logWriteQueue
    .then(async () => {
      const { [STORAGE_KEYS.LOGS]: logsRaw } = await chrome.storage.local.get(STORAGE_KEYS.LOGS);
      const logs = Array.isArray(logsRaw) ? logsRaw : [];
      logs.unshift({
        id: Date.now().toString(),
        timestamp: Date.now(),
        type,
        message,
      });
      await saveLogs(logs);
    })
    .catch(() => {}); // never let one failed write break the queue for subsequent logs
  return logWriteQueue;
}

// ─── Usage Cache ─────────────────────────────────────────────────────────────

async function getCachedUsage() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.LAST_USAGE);
  return result[STORAGE_KEYS.LAST_USAGE] || null;
}

/**
 * Throttle check: return cached data if last fetch was within throttle window.
 * Returns null if a fresh fetch is needed.
 */
async function applyUsageThrottle(cached) {
  if (!cached) return null;
  const { [STORAGE_KEYS.LAST_FETCH_AT]: lastFetchAt } =
    await chrome.storage.local.get(STORAGE_KEYS.LAST_FETCH_AT);
  if (!lastFetchAt) return null;
  if (Date.now() - lastFetchAt < USAGE_REFRESH_THROTTLE_MS) return cached;
  return null;
}
