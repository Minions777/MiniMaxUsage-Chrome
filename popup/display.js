// MiniMax Token Monitor - Usage display and panel switching
// Owns: displayUsage() + show*() panel state functions + refreshUsageDisplay().

(function () {
  'use strict';

  const { state, dom, initDom } = window.PMM;
  const { formatNumber, formatTime, formatTokensCN, colorForPercentage } = window.PMM.util;

  // ─── Panel switching ──────────────────────────────────────────────────────
  // Each show*() moves keyboard focus into the revealed panel's back button so
  // keyboard/AT users are not stranded on a now-hidden header button. (The
  // hidden panels use display:none, which already removes them from the a11y
  // tree, but explicit focus management is still needed.)

  function focusById(id) {
    const el = document.getElementById(id);
    if (el && typeof el.focus === 'function') el.focus();
  }

  function showLoading() {
    initDom();
    dom.loading.style.display = 'flex';
    dom.mainContent.style.display = 'none';
    dom.settingsPanel.style.display = 'none';
    dom.historyPanel.style.display = 'none';
  }

  function showMain() {
    initDom();
    dom.loading.style.display = 'none';
    dom.mainContent.style.display = 'flex';
    dom.settingsPanel.style.display = 'none';
    dom.historyPanel.style.display = 'none';
    dom.logPanel.style.display = 'none';
    focusById('btnRefresh');
  }

  function showEmpty() {
    initDom();
    dom.loading.style.display = 'none';
    dom.mainContent.style.display = 'flex';
    dom.emptyState.style.display = 'flex';
    dom.usageSection.style.display = 'none';
    dom.errorState.style.display = 'none';
  }

  function showUsage() {
    initDom();
    dom.loading.style.display = 'none';
    dom.mainContent.style.display = 'flex';
    dom.emptyState.style.display = 'none';
    dom.usageSection.style.display = 'flex';
    dom.errorState.style.display = 'none';
  }

  function showError(err) {
    initDom();
    dom.loading.style.display = 'none';
    dom.mainContent.style.display = 'flex';
    dom.emptyState.style.display = 'none';
    dom.usageSection.style.display = 'none';
    dom.errorState.style.display = 'flex';
    dom.errorMessage.textContent = err;
  }

  function showSettings() {
    initDom();
    dom.loading.style.display = 'none';
    dom.mainContent.style.display = 'none';
    dom.settingsPanel.style.display = 'flex';
    dom.historyPanel.style.display = 'none';
    focusById('btnBackFromSettings');
  }

  function showHistory() {
    initDom();
    dom.loading.style.display = 'none';
    dom.mainContent.style.display = 'none';
    dom.settingsPanel.style.display = 'none';
    dom.historyPanel.style.display = 'flex';
    dom.logPanel.style.display = 'none';
    window.PMM.historyPanel.load();
    focusById('btnBackFromHistory');
  }

  function showLogPanel() {
    initDom();
    dom.loading.style.display = 'none';
    dom.mainContent.style.display = 'none';
    dom.settingsPanel.style.display = 'none';
    dom.historyPanel.style.display = 'none';
    dom.logPanel.style.display = 'flex';
    window.PMM.logPanel.load();
    focusById('btnBackFromLog');
  }

  // ─── Ring rendering ───────────────────────────────────────────────────────

  // Endpoint display metadata (ENDPOINTS lives in the background SW config, not
  // the popup, so mirror the human-readable name + flag here for the footer).
  const ENDPOINT_LABELS = {
    china: { name: 'China', flag: '🇨🇳' },
    international: { name: 'International', flag: '🌏' },
  };

  const RING_RADIUS = 50;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

  function paintRing(svgEl, percentEl, usedPct, isWeekly) {
    // Ring fill grows with usage; color follows the REMAINING fraction so the
    // green/orange/red thresholds (colorForPercentage) keep their "low
    // remaining = red" meaning even though the number shown is 已用%.
    const remainingPct = 1 - usedPct;
    const offset = RING_CIRCUMFERENCE * (1 - usedPct);
    const colorInfo = colorForPercentage(remainingPct, isWeekly);

    svgEl.style.strokeDasharray = RING_CIRCUMFERENCE;
    svgEl.style.strokeDashoffset = offset;
    svgEl.style.stroke = colorInfo.gradient;
    svgEl.style.filter = `drop-shadow(0 0 6px ${colorInfo.shadow})`;

    percentEl.textContent = Math.round(usedPct * 100) + '%';
    percentEl.style.color = colorInfo.color;
    percentEl.style.textShadow = `0 0 10px ${colorInfo.shadow}`;
  }

  // ─── Usage rendering ──────────────────────────────────────────────────────

  // M3: usedPercent/remainingPercent are already resolved + clamped to 0..100
  // by core.js (resolveUsagePercents). Trust them — do not re-derive here.
  // Rings display 已用% (matches the official site); color is derived from
  // the remaining fraction inside paintRing.
  function displayUsage(usage) {
    initDom();

    // 5-hour ring (已用%)
    const intervalUsedPct = (usage.intervalUsedPercent ?? 0) / 100;
    paintRing(dom.ringProgress, dom.ringPercent, intervalUsedPct, false);

    // Weekly ring (已用%)
    const weeklyUsedPct = (usage.weeklyUsedPercent ?? 0) / 100;
    paintRing(dom.weeklyRingProgress, dom.weeklyRingPercent, weeklyUsedPct, true);

    // Reset time
    dom.intervalResetTime.textContent = usage.intervalResetTimeStr || '--';

    // Token stats
    if (usage.tokenStats) {
      dom.statYesterday.textContent = formatTokensCN(usage.tokenStats.yesterday);
      dom.statSevenDay.textContent = formatTokensCN(usage.tokenStats.sevenDay);
      dom.statMonth.textContent = formatTokensCN(usage.tokenStats.month);
      dom.statPeriod.textContent = formatTokensCN(usage.tokenStats.period);
      dom.statTotalTokens.textContent = formatTokensCN(usage.tokenStats.total);
    } else {
      dom.statYesterday.textContent = '--';
      dom.statSevenDay.textContent = '--';
      dom.statMonth.textContent = '--';
      dom.statPeriod.textContent = '--';
      dom.statTotalTokens.textContent = '--';
    }

    // Subscription expiry
    if (usage.subscription && usage.subscription.daysUntilEnd != null && usage.subscription.daysUntilEnd > 0) {
      dom.subscriptionGroup.style.display = 'flex';
      dom.subscriptionDays.textContent = usage.subscription.daysUntilEnd;
    } else {
      dom.subscriptionGroup.style.display = 'none';
    }

    // Footer — use the actual fetch timestamp (carried on the usage object),
    // not the popup-open wall-clock time (which previously showed "now" even
    // for data fetched minutes ago).
    const fetchedAt = usage.fetchedAt ? new Date(usage.fetchedAt) : new Date();
    dom.lastUpdated.textContent = '更新于 ' + formatTime(fetchedAt);

    // Endpoint label — show the endpoint's display name, not the raw key.
    const endpointKey = state.currentSettings.endpoint || 'china';
    const endpointMeta = ENDPOINT_LABELS[endpointKey];
    dom.endpointLabel.textContent = endpointMeta
      ? `${endpointMeta.name} · ${endpointMeta.flag}`
      : endpointKey;

    // Auto-refresh indicator — reflect the actual setting (previously always
    // said "自动刷新中" even when auto-refresh was disabled).
    const interval = state.currentSettings.autoRefreshInterval || 60;
    if (state.currentSettings.autoRefreshEnabled === false) {
      dom.refreshText.textContent = '已暂停自动刷新';
      dom.refreshIndicator.classList.add('paused');
    } else {
      dom.refreshText.textContent = `自动刷新中 · 每 ${interval}s`;
      dom.refreshIndicator.classList.remove('paused');
    }

    showUsage();
  }

  // ─── Background messaging ─────────────────────────────────────────────────

  async function refreshUsageDisplay(force = false) {
    if (!state.currentSettings) {
      state.currentSettings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    }
    if (!state.currentSettings.apiKey) {
      showEmpty();
      return;
    }

    let result;
    try {
      const type = force ? 'REFRESH_USAGE' : 'GET_USAGE';
      result = await chrome.runtime.sendMessage({ type });
    } catch {
      showError('获取用量失败，请稍后重试');
      return;
    }

    if (!result) {
      showError('获取用量失败，请稍后重试');
      return;
    }
    if (result.error) {
      if (result.error === 'NO_API_KEY') showEmpty();
      else showError(result.error);
      return;
    }
    displayUsage(result);
  }

  const PMM = window.PMM;
  PMM.display = {
    displayUsage,
    refreshUsageDisplay,
    showLoading,
    showMain,
    showEmpty,
    showUsage,
    showError,
    showSettings,
    showHistory,
    showLogPanel,
  };
})();
