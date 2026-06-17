// MiniMax Token Monitor - Usage display and panel switching
// Owns: displayUsage() + show*() panel state functions + refreshUsageDisplay().

(function () {
  'use strict';

  const { state, dom, initDom } = window.PMM;
  const { formatNumber, formatTime, formatTokensCN, colorForPercentage } = window.PMM.util;

  // ─── Panel switching ──────────────────────────────────────────────────────

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
  }

  function showHistory() {
    initDom();
    dom.loading.style.display = 'none';
    dom.mainContent.style.display = 'none';
    dom.settingsPanel.style.display = 'none';
    dom.historyPanel.style.display = 'flex';
    dom.logPanel.style.display = 'none';
    window.PMM.historyPanel.load();
  }

  function showLogPanel() {
    initDom();
    dom.loading.style.display = 'none';
    dom.mainContent.style.display = 'none';
    dom.settingsPanel.style.display = 'none';
    dom.historyPanel.style.display = 'none';
    dom.logPanel.style.display = 'flex';
    window.PMM.logPanel.load();
  }

  // ─── Ring rendering ───────────────────────────────────────────────────────

  const RING_RADIUS = 50;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

  function paintRing(svgEl, percentEl, remainingPct, isWeekly) {
    const offset = RING_CIRCUMFERENCE * (1 - remainingPct);
    const colorInfo = colorForPercentage(remainingPct, isWeekly);

    svgEl.style.strokeDasharray = RING_CIRCUMFERENCE;
    svgEl.style.strokeDashoffset = offset;
    svgEl.style.stroke = colorInfo.gradient;
    svgEl.style.filter = `drop-shadow(0 0 6px ${colorInfo.shadow})`;

    percentEl.textContent = Math.round(remainingPct * 100) + '%';
    percentEl.style.color = colorInfo.color;
    percentEl.style.textShadow = `0 0 10px ${colorInfo.shadow}`;
  }

  // ─── Usage rendering ──────────────────────────────────────────────────────

  // M3: remainingPercent 字段已被 background.js 反转 (0-100) 为"剩余%"
  function displayUsage(usage) {
    initDom();

    // 5-hour ring
    const total = usage.intervalTotal || 1;
    const remainingPct = usage.intervalRemainingPercent != null
      ? usage.intervalRemainingPercent / 100
      : (total > 0 ? usage.intervalRemains / total : 0);

    paintRing(dom.ringProgress, dom.ringPercent, remainingPct, false);

    // Weekly ring
    const weeklyRemainingPct = usage.weeklyRemainingPercent != null
      ? usage.weeklyRemainingPercent / 100
      : (usage.weeklyTotal > 0 ? usage.weeklyRemains / usage.weeklyTotal : 0);

    paintRing(dom.weeklyRingProgress, dom.weeklyRingPercent, weeklyRemainingPct, true);

    // Reset time
    dom.intervalResetTime.textContent = usage.intervalResetTimeStr || '--';

    // Token stats (including new period + total from VSCode extension reference)
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

    // Footer
    dom.lastUpdated.textContent = '更新于 ' + formatTime(new Date());
    const endpointName = state.currentSettings.endpoint === 'china' ? '🇨🇳' : '🌏';
    dom.endpointLabel.textContent = state.currentSettings.endpoint + ' · ' + endpointName;
    const interval = state.currentSettings.autoRefreshInterval || 60;
    dom.refreshText.textContent = `自动刷新中 · 每 ${interval}s`;

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