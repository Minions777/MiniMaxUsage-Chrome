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

async function saveHistory(history) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const fresh = history.filter(r => r.timestamp > cutoff);

  const grouped = {};
  fresh.forEach(r => {
    const dayKey = new Date(r.timestamp).toDateString();
    if (!grouped[dayKey]) grouped[dayKey] = [];
    grouped[dayKey].push(r);
  });

  const limited = [];
  Object.values(grouped).forEach(dayRecords => {
    dayRecords.sort((a, b) => b.timestamp - a.timestamp);
    limited.push(...dayRecords.slice(0, 24));
  });
  limited.sort((a, b) => b.timestamp - a.timestamp);

  await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: limited });
}

/**
 * Add a history record for the current usage snapshot.
 *
 * [Task-6] IMPROVED DEDUP STRATEGY:
 * Uses `windowStartTime` (absolute start of the 5h window) as the primary
 * dedup key — it's perfectly stable within a window since it's an absolute
 * timestamp from the API, not a computed value like `intervalResetTime`
 * (which = Date.now() + remains_time_ms and shifts slightly per fetch).
 *
 * Falls back to `intervalResetTime` if `windowStartTime` is unavailable.
 *
 * A dedicated storage key (LAST_WINDOW_KEY) tracks the last recorded window,
 * decoupled from LAST_USAGE — so even if LAST_USAGE is updated without a new
 * history record, dedup still works correctly.
 */
async function addHistoryRecord(usage) {
  // Prefer windowStartTime (stable absolute start) over intervalResetTime (computed)
  const windowKey = usage.windowStartTime
    || usage.intervalResetTime
    || String(Date.now());

  const { [STORAGE_KEYS.LAST_WINDOW_KEY]: lastKey } =
    await chrome.storage.local.get(STORAGE_KEYS.LAST_WINDOW_KEY);

  if (lastKey === windowKey) return; // Same window already recorded — skip

  const history = await getHistory();
  history.unshift({
    id: Date.now().toString(),
    timestamp: Date.now(),
    used: usage.intervalUsed,
    remains: usage.intervalRemains,
    total: usage.intervalTotal,
  });
  await saveHistory(history);

  // Persist the dedup key independently from LAST_USAGE
  await chrome.storage.local.set({ [STORAGE_KEYS.LAST_WINDOW_KEY]: windowKey });
}

// ─── Logs ────────────────────────────────────────────────────────────────────

async function getLogs() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.LOGS);
  return result[STORAGE_KEYS.LOGS] || [];
}

async function saveLogs(logs) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const filtered = logs.filter(r => r.timestamp > cutoff).slice(-200);
  await chrome.storage.local.set({ [STORAGE_KEYS.LOGS]: filtered });
}

async function addLog(type, message) {
  const logs = await getLogs();
  logs.unshift({
    id: Date.now().toString(),
    timestamp: Date.now(),
    type,
    message,
  });
  await saveLogs(logs);
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