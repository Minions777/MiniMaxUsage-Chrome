// MiniMax Token Monitor - Shared popup state
// Holds runtime state (settings, theme, refresh flag) and a cached map of
// DOM element references used across panels.

(function () {
  'use strict';

  const PMM = window.PMM || (window.PMM = {});

  // ─── Runtime state ────────────────────────────────────────────────────────
  const state = {
    currentSettings: null,
    currentTheme: 'neon',
    isRefreshing: false,
  };

  // ─── DOM cache ────────────────────────────────────────────────────────────
  // Built lazily on first init() so this module can load before the popup
  // body is in the DOM (script tags are at end of body in popup.html).
  const dom = {};
  let domInitialized = false;

  function initDom() {
    if (domInitialized) return;
    const get = (id) => document.getElementById(id);
    Object.assign(dom, {
      // Top-level panels
      loading: get('loading'),
      mainContent: get('mainContent'),
      emptyState: get('emptyState'),
      usageSection: get('usageSection'),
      errorState: get('errorState'),
      settingsPanel: get('settingsPanel'),
      historyPanel: get('historyPanel'),
      logPanel: get('logPanel'),
      logList: get('logList'),
      refreshOverlay: get('refreshOverlay'),

      // 5h ring
      ringProgress: get('ringProgress'),
      ringPercent: get('ringPercent'),
      statUsed: get('statUsed'),
      statTotal: get('statTotal'),
      intervalResetTime: get('intervalResetTime'),

      // Weekly ring
      weeklyRingProgress: get('weeklyRingProgress'),
      weeklyRingPercent: get('weeklyRingPercent'),
      statWeeklyRemains: get('statWeeklyRemains'),
      statWeeklyTotal: get('statWeeklyTotal'),
      statWeeklyRemainsCard: get('statWeeklyRemainsCard'),

      // Token stats
      statYesterday: get('statYesterday'),
      statSevenDay: get('statSevenDay'),
      statMonth: get('statMonth'),

      // Subscription
      subscriptionGroup: get('subscriptionGroup'),
      subscriptionDays: get('subscriptionDays'),

      // Footer
      lastUpdated: get('lastUpdated'),
      endpointLabel: get('endpointLabel'),
      refreshText: get('refreshText'),
      errorMessage: get('errorMessage'),

      // Settings
      inputAPIKey: get('inputAPIKey'),
      toggleAutoRefresh: get('toggleAutoRefresh'),
      intervalField: get('intervalField'),

      // History
      histAvg: get('histAvg'),
      histMax: get('histMax'),
      histDays: get('histDays'),
      weeklyChart: get('weeklyChart'),
      historyList: get('historyList'),
    });
    domInitialized = true;
  }

  PMM.state = state;
  PMM.dom = dom;
  PMM.initDom = initDom;
})();