// MiniMax Token Monitor - Pure utility functions
// No DOM, no chrome.*, no side effects — safe to unit test under Node/jsdom.
//
// This module is the SINGLE SOURCE OF TRUTH for all pure decision logic
// (M3 reversal, model selection, dedup keys, cache TTL, retry policy, badge
// color, log/history pruning). Background modules and the test suite both call
// these functions so the tests exercise the REAL production logic instead of
// re-deriving it inline (which previously passed even when production code was
// broken — see P1 audit finding).

(function (root, factory) {
  const exports = factory();
  if (typeof module === 'object' && module && module.exports) {
    // CJS (vitest, Node)
    module.exports = exports;
  } else if (typeof define === 'function' && define.amd) {
    define([], () => exports);
  } else {
    // Browser (popup) and Service Worker: merge under PMM.util when available,
    // and always also attach named globals so background.js can use them
    // directly via importScripts.
    // Popup scripts (display.js / panels/*.js) destructure from window.PMM.util
    // at module-evaluation time — BEFORE state.js has run — so this file can be
    // the first PMM.* producer. Ensure root.PMM exists before attaching .util.
    root.PMM = root.PMM || {};
    root.PMM.util = Object.assign(root.PMM.util || {}, exports);
    Object.assign(root, exports);
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // ─── Shared policy constants ───────────────────────────────────────────────
  // Color-threshold policy (single source for both utils.colorForPercentage
  // on a 0..1 scale and badge.badgeColorHex on a 0..100 scale).
  // remaining% >= GREEN = green, >= ORANGE = orange, else red.
  const COLOR_THRESHOLDS = { GREEN_PCT: 60, ORANGE_PCT: 30 };

  // Billing aggregation window (days). Shared by api.js fetchAllBillingRecords
  // (fetch window) and calculateTokenStats (aggregation window) so the fetch
  // and the aggregation cannot drift apart. Lives here (not config.js) because
  // utils.js loads BEFORE config.js in the importScripts order and cannot
  // reference config globals.
  const BILLING_WINDOW_DAYS = 30;

  // ─── Formatting ─────────────────────────────────────────────────────────────

  function formatNumber(num) {
    if (num == null || isNaN(num)) return '--';
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
    if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
    return num.toString();
  }

  function formatTime(date) {
    const h = date.getHours().toString().padStart(2, '0');
    const m = date.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  }

  function formatTimeSeconds(date) {
    const h = date.getHours().toString().padStart(2, '0');
    const m = date.getMinutes().toString().padStart(2, '0');
    const s = date.getSeconds().toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  function formatDate(timestamp) {
    const d = new Date(timestamp);
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${month}/${day}`;
  }

  function formatTokensCN(tokens) {
    if (tokens == null || isNaN(tokens)) return '--';
    if (tokens >= 100000000) return `${(tokens / 100000000).toFixed(1)}亿`;
    if (tokens >= 10000) return `${(tokens / 10000).toFixed(1)}万`;
    return tokens.toString();
  }

  // ─── Color ───────────────────────────────────────────────────────────────────

  /**
   * Color info for a given remaining percentage.
   *
   * ⚠️ M3 API CRITICAL NOTE:
   * `remainingPct` here is the CORRECTED remaining% (already reversed from the
   * M3 API's misleading `remaining_percent` field, which actually means "used
   * percent"). By the time it reaches here, higher = more quota available.
   *
   * @param {number} remainingPct - Corrected remaining% as 0..1 (higher = more available)
   * @param {boolean} [isWeekly=false] - Use weekly gradient palette
   */
  function colorForPercentage(remainingPct, isWeekly = false) {
    if (isWeekly) {
      return { color: '#4facfe', gradient: 'url(#weeklyGradient)', shadow: 'rgba(79, 172, 254, 0.4)' };
    }
    if (remainingPct >= COLOR_THRESHOLDS.GREEN_PCT / 100) {
      return { color: 'var(--accent)', gradient: 'url(#greenGradient)', shadow: 'var(--accent-glow)' };
    }
    if (remainingPct >= COLOR_THRESHOLDS.ORANGE_PCT / 100) {
      return { color: 'var(--orange-color)', gradient: 'url(#orangeGradient)', shadow: 'rgba(245, 166, 35, 0.4)' };
    }
    return { color: 'var(--red-color)', gradient: 'url(#redGradient)', shadow: 'rgba(255, 107, 107, 0.4)' };
  }

  /**
   * Concrete hex badge color for the SW badge API (chrome.action.setBadgeBackgroundColor
   * needs a real color, not a CSS var). Uses the shared COLOR_THRESHOLDS so the
   * threshold policy has a single source of truth alongside colorForPercentage.
   * @param {number} remainingPct - Corrected remaining% on a 0..100 scale
   */
  function badgeColorHex(remainingPct) {
    if (remainingPct >= COLOR_THRESHOLDS.GREEN_PCT) return '#00d09c';
    if (remainingPct >= COLOR_THRESHOLDS.ORANGE_PCT) return '#fdcb6e';
    return '#ff7675';
  }

  // ─── Dates ──────────────────────────────────────────────────────────────────

  // 计算距离指定 Date 的剩余天数 (向上取整, 最小 0)
  function daysUntil(date) {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) return null;
    return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 86400000));
  }

  // M3: 格式化相对毫秒数为 "X 小时 Y 分钟后重置" 字符串
  function formatResetCountdownMs(ms) {
    if (!ms || ms <= 0) return '--';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (h > 0) return m > 0 ? `${h} 小时 ${m} 分钟后重置` : `${h} 小时后重置`;
    return `${m} 分钟后重置`;
  }

  // ─── Token stats ─────────────────────────────────────────────────────────────

  // Token 消耗统计: 按 todayStart / 7daysAgo / monthStart / BILLING_WINDOW_DAYS 四个窗口聚合
  // records: [{ created_at: <unix-seconds>, consume_token: <number> }]
  // totalTokens: aggregate lifetime consumption from server-side endpoint (optional)
  function calculateTokenStats(records, now = new Date(), totalTokens = 0) {
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const sevenDaysAgo = now.getTime() - 7 * 86400000;
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const windowAgo = now.getTime() - BILLING_WINDOW_DAYS * 86400000;

    let yesterdayTokens = 0;
    let sevenDayTokens = 0;
    let monthTokens = 0;
    let periodTokens = 0;

    for (const r of records || []) {
      const ts = r.created_at * 1000;
      const token = Number(r.consume_token) || 0;
      if (ts >= todayStart - 86400000 && ts < todayStart) yesterdayTokens += token;
      if (ts >= sevenDaysAgo) sevenDayTokens += token;
      if (ts >= monthStart) monthTokens += token;
      if (ts >= windowAgo) periodTokens += token;
    }
    // totalTokens comes from aggregate endpoint; if 0, fall back to periodTokens
    return { yesterdayTokens, sevenDayTokens, monthTokens, periodTokens, totalTokens: totalTokens || periodTokens };
  }

  // ─── M3 API semantic-correction pure logic ─────────────────────────────────

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ⚠️  M3 API SEMANTIC NOTE  ⚠️
  // The MiniMax M3 API field `current_*_remaining_percent` is TRUTHFULLY named:
  // it is the REMAINING percent, measured against the BOOSTED total. The weekly
  // total can be boosted above the base quota by `weekly_boost_permille`
  // (1500 = 1.5×). The official site shows "已用%" measured against the BASE.
  //
  // To match the official site:
  //   used%      = (100 − rawRemaining) × boostFactor   (boostFactor = permille/1000)
  //   remaining% = 100 − used%
  // resolveUsagePercents() applies this AND clamps to [0,100] AND falls back to
  // a count-based ratio when the API field is absent. It never returns null, so
  // downstream consumers (badge.js, display.js) can trust the resolved values.
  //
  // (Earlier code wrongly treated the field as "used%" and did 100−value; that
  //  produced a number matching neither the official "已用%" nor the true
  //  remaining%, AND it ignored the boost factor — the cause of the
  //  "extension 30% vs official 43%" discrepancy.)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Resolve used% and remaining% (both relative to the BASE quota, 0..100) from
   * a raw M3 `*_remaining_percent` field.
   * @param {number|null|undefined} rawRemainingPct - raw `*_remaining_percent`
   *   (remaining % of the BOOSTED total); null/undefined → count fallback
   * @param {number} boostPermille - e.g. 1500 for a 1.5× weekly boost, 1000 for
   *   the 5-hour interval (no boost)
   * @param {number} total - interval/weekly total count (fallback only)
   * @param {number} used - interval/weekly used count (fallback only)
   * @returns {{usedPct:number, remainingPct:number}} both 0..100 integers,
   *   summing to 100
   */
  function resolveUsagePercents(rawRemainingPct, boostPermille, total, used) {
    let usedPct;
    if (rawRemainingPct != null && !isNaN(rawRemainingPct)) {
      const boostFactor = (Number(boostPermille) || 1000) / 1000;
      usedPct = (100 - Number(rawRemainingPct)) * boostFactor;
    } else {
      usedPct = total > 0 ? ((Number(used) || 0) / total) * 100 : 0;
    }
    const u = Math.max(0, Math.min(100, Math.round(usedPct)));
    return { usedPct: u, remainingPct: 100 - u };
  }

  // ─── Model selection ─────────────────────────────────────────────────────────

  /**
   * Select the primary model from the M3 `model_remains` array.
   * Fallback chain: MiniMax-M* → general → first with quota → first.
   * @param {Array} models - API model_remains array
   * @returns {object|undefined} selected model
   */
  function selectMainModel(models) {
    if (!Array.isArray(models) || models.length === 0) return undefined;
    return models.find(m => m.model_name?.startsWith('MiniMax-M'))
      || models.find(m => m.model_name === 'general')
      || models.find(m => m.current_interval_total_count > 0)
      || models[0];
  }

  // ─── Dedup key ───────────────────────────────────────────────────────────────

  /**
   * Stable dedup key for a usage snapshot.
   * Prefers `windowStartTime` (absolute API start of the 5h window — bit-stable
   * across fetches) over `intervalResetTime` (= Date.now()+remains_ms, drifts
   * per fetch). Used by both history recording (storage.js) and low-usage
   * notifications (badge.js) so the same window is only recorded/notified once.
   * @param {object} usage
   * @param {number} [now=Date.now()] - injectable for deterministic tests
   */
  function dedupWindowKey(usage, now = Date.now()) {
    return usage.windowStartTime || usage.intervalResetTime || String(now);
  }

  // ─── Billing cache freshness ────────────────────────────────────────────────

  /**
   * Whether a billing cache object is still fresh.
   * Fresh = present, has records, and age <= ttl.
   * @param {object|null} cache - { records: [], fetchedAt: number }
   * @param {number} ttlMs - TTL in ms
   * @param {number} [now=Date.now()] - injectable for deterministic tests
   */
  function isBillingCacheFresh(cache, ttlMs, now = Date.now()) {
    return !!(cache && cache.records && cache.records.length > 0
      && (now - (cache.fetchedAt || 0)) <= ttlMs);
  }

  /**
   * Whether the alarm/init handler should include a billing fetch this cycle.
   * Inverse of isBillingCacheFresh — true when cache is missing/expired/empty.
   */
  function shouldIncludeBilling(cache, ttlMs, now = Date.now()) {
    return !isBillingCacheFresh(cache, ttlMs, now);
  }

  // ─── Retry policy ────────────────────────────────────────────────────────────

  /**
   * Whether an HTTP status should be retried by fetchJsonWithRetry.
   * Retry on: 5xx, 408 (Request Timeout), 429 (Too Many Requests).
   * Do NOT retry on: 4xx (except 408/429) — client errors won't self-heal.
   * @param {number} status - HTTP status code
   */
  function shouldRetryStatus(status) {
    if (status >= 400 && status < 500 && status !== 408 && status !== 429) return false;
    return true;
  }

  // ─── Log / history pruning ───────────────────────────────────────────────────

  /**
   * Prune a newest-first log array to retention window + max count.
   * Keeps the NEWEST `max` entries within `retentionDays`. Input is assumed
   * newest-first (addLog uses unshift); output is newest-first.
   * @param {Array} logs - newest-first log array
   * @param {number} now - reference timestamp (ms)
   * @param {number} retentionDays - drop entries older than this
   * @param {number} max - cap on entry count
   */
  function pruneLogs(logs, now, retentionDays, max) {
    const cutoff = now - retentionDays * 86400000;
    return (logs || [])
      .filter(r => r && r.timestamp > cutoff)
      .slice(0, max); // newest-first → keep first `max`
  }

  /**
   * Prune + cap history records: drop entries older than `retentionDays`, and
   * keep at most `maxPerDay` records per day (newest-first within each day).
   * Output is newest-first overall.
   * @param {Array} history - history array (any order)
   * @param {number} now - reference timestamp (ms)
   * @param {number} retentionDays
   * @param {number} maxPerDay
   */
  function pruneHistoryRecords(history, now, retentionDays, maxPerDay) {
    const cutoff = now - retentionDays * 86400000;
    const fresh = (history || []).filter(r => r && r.timestamp > cutoff);

    const grouped = {};
    fresh.forEach(r => {
      const dayKey = new Date(r.timestamp).toDateString();
      if (!grouped[dayKey]) grouped[dayKey] = [];
      grouped[dayKey].push(r);
    });

    const limited = [];
    Object.values(grouped).forEach(dayRecords => {
      dayRecords.sort((a, b) => b.timestamp - a.timestamp);
      limited.push(...dayRecords.slice(0, maxPerDay));
    });
    limited.sort((a, b) => b.timestamp - a.timestamp);
    return limited;
  }

  // ─── HTML escaping ───────────────────────────────────────────────────────────

  // escapeHtml 需要 DOM (createElement), 在 Node 环境下提供一个简化版本
  // 仅用于纯文本+单引号+双引号+尖括号+& 转义，足以覆盖 popup 中的用法
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  return {
    COLOR_THRESHOLDS,
    BILLING_WINDOW_DAYS,
    formatNumber,
    formatTime,
    formatTimeSeconds,
    formatDate,
    formatTokensCN,
    colorForPercentage,
    badgeColorHex,
    daysUntil,
    formatResetCountdownMs,
    calculateTokenStats,
    resolveUsagePercents,
    selectMainModel,
    dedupWindowKey,
    isBillingCacheFresh,
    shouldIncludeBilling,
    shouldRetryStatus,
    pruneLogs,
    pruneHistoryRecords,
    escapeHtml,
  };
});
