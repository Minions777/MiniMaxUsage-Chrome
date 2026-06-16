// MiniMax Token Monitor - Shared utilities
// Pure / DOM-free helpers and stateless DOM utilities used across popup modules.
// All exports hang off window.PMM to avoid global pollution (no IIFE wrappers
// since the script load order in popup.html is deterministic).

(function () {
  'use strict';

  const PMM = window.PMM || (window.PMM = {});

  // ─── Formatters ───────────────────────────────────────────────────────────

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

  // ─── Color/gradient picker ────────────────────────────────────────────────
  // M3: 字段语义已经反转，remainingPct 是 "剩余%" (0..1)
  // isWeekly=true 时使用本周限额的固定蓝紫配色（与主题无关）
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

  // ─── HTML escape ──────────────────────────────────────────────────────────
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
  }

  PMM.util = {
    formatNumber,
    formatTime,
    formatTimeSeconds,
    formatDate,
    formatTokensCN,
    colorForPercentage,
    escapeHtml,
  };
})();