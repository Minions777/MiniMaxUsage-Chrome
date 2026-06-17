// MiniMax Token Monitor - Pure utility functions
// No DOM, no chrome.*, no globals — safe to unit test under Node/jsdom.

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
    // background.js (importScripts) and tests (CJS) are unaffected: SW also
    // benefits from root.PMM being created; tests take the module.exports
    // branch above and never reach here.
    root.PMM = root.PMM || {};
    root.PMM.util = Object.assign(root.PMM.util || {}, exports);
    Object.assign(root, exports);
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

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

  /**
 * Color info for a given remaining percentage.
 *
 * ⚠️ M3 API CRITICAL NOTE:
 * The `remainingPct` parameter here represents the CORRECTED remaining%
 * (already reversed from the M3 API's misleading `remaining_percent` field).
 * The raw API field `current_interval_remaining_percent` actually means
 * "USED percent" (92 = 92% used), but by the time it reaches this function,
 * it has been reversed to the true meaning: higher = more quota remaining.
 *
 * @param {number} remainingPct - Corrected remaining% as 0..1 (higher = more available)
 * @param {boolean} [isWeekly=false] - Use weekly gradient palette
 */
  function colorForPercentage(remainingPct, isWeekly = false) {
    if (isWeekly) {
      return { color: '#4facfe', gradient: 'url(#weeklyGradient)', shadow: 'rgba(79, 172, 254, 0.4)' };
    }
    if (remainingPct >= 0.6) {
      return { color: 'var(--accent)', gradient: 'url(#greenGradient)', shadow: 'var(--accent-glow)' };
    }
    if (remainingPct >= 0.3) {
      return { color: 'var(--orange-color)', gradient: 'url(#orangeGradient)', shadow: 'rgba(245, 166, 35, 0.4)' };
    }
    return { color: 'var(--red-color)', gradient: 'url(#redGradient)', shadow: 'rgba(255, 107, 107, 0.4)' };
  }

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

  // Token 消耗统计: 按 todayStart / 7daysAgo / monthStart / 30daysAgo 四个窗口聚合
  // records: [{ created_at: <unix-seconds>, consume_token: <number> }]
  // totalTokens: aggregate lifetime consumption from server-side endpoint (optional)
  function calculateTokenStats(records, now = new Date(), totalTokens = 0) {
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const sevenDaysAgo = now.getTime() - 7 * 86400000;
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const thirtyDaysAgo = now.getTime() - 30 * 86400000;

    let yesterdayTokens = 0;
    let sevenDayTokens = 0;
    let monthTokens = 0;
    let periodTokens = 0;  // 近30天

    for (const r of records) {
      const ts = r.created_at * 1000;
      const token = Number(r.consume_token) || 0;
      if (ts >= todayStart - 86400000 && ts < todayStart) yesterdayTokens += token;
      if (ts >= sevenDaysAgo) sevenDayTokens += token;
      if (ts >= monthStart) monthTokens += token;
      if (ts >= thirtyDaysAgo) periodTokens += token;
    }
    // totalTokens comes from aggregate endpoint; if 0, fall back to periodTokens
    return { yesterdayTokens, sevenDayTokens, monthTokens, periodTokens, totalTokens: totalTokens || periodTokens };
  }

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
    formatNumber,
    formatTime,
    formatTimeSeconds,
    formatDate,
    formatTokensCN,
    colorForPercentage,
    daysUntil,
    formatResetCountdownMs,
    calculateTokenStats,
    escapeHtml,
  };
});