// MiniMax Token Monitor - Entry point
// Wires panels, hooks up background message listener, runs init() on DOMContentLoaded.

(function () {
  'use strict';

  const { state, initDom } = window.PMM;
  const { display } = window.PMM;

  async function init() {
    initDom();
    display.showLoading();

    // Theme first to avoid color flash
    state.currentTheme = await window.PMM.theme.getTheme();
    window.PMM.theme.applyTheme(state.currentTheme);
    // Pre-fill settings form before panels bind so default values reflect if user
    // opens settings without ever having saved anything.
    window.PMM.settingsPanel.applySettingsToUI({ endpoint: 'china', autoRefreshEnabled: true, autoRefreshInterval: 60 });

    // Background listener
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'USAGE_UPDATED') {
        display.refreshUsageDisplay();
      }
      // 同步处理，不保持异步通道；显式 return 避免 sendResponse 警告
      return undefined;
    });

    // Load settings and cached usage in parallel (two independent SW round-trips;
    // previously awaited sequentially, adding one round-trip of latency per open).
    // applySettingsToUI must still run before displayUsage, which reads
    // state.currentSettings, so we wait for both then apply settings first.
    const [settings, cached] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }),
      chrome.runtime.sendMessage({ type: 'GET_USAGE' }),
    ]);
    state.currentSettings = settings;
    window.PMM.settingsPanel.applySettingsToUI(state.currentSettings);

    if (cached && !cached.error) {
      display.displayUsage(cached);
    } else if (cached?.error === 'NO_API_KEY') {
      display.showEmpty();
      display.showMain();
      return;
    }

    display.showMain();
  }

  // Theme helpers re-exported from themes.js (getTheme, applyTheme, updateThemeUI, saveTheme)
  // are global on window; the entry point only orchestrates.

  document.addEventListener('DOMContentLoaded', () => {
    // Panel event bindings (each module's bind() is idempotent on DOMContentLoaded)
    window.PMM.settingsPanel.bind();
    window.PMM.historyPanel.bind();
    window.PMM.logPanel.bind();

    // Header buttons
    const btnRefresh = document.getElementById('btnRefresh');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', async () => {
        if (state.isRefreshing) return;
        state.isRefreshing = true;
        btnRefresh.classList.add('spinning');
        try {
          await display.refreshUsageDisplay(true);
        } finally {
          btnRefresh.classList.remove('spinning');
          state.isRefreshing = false;
        }
      });
    }
    const btnSettings = document.getElementById('btnSettings');
    if (btnSettings) {
      btnSettings.addEventListener('click', () => {
        if (window.PMM.settingsPanel && window.PMM.settingsPanel.applySettingsToUI) {
          window.PMM.settingsPanel.applySettingsToUI(state.currentSettings);
        }
        display.showSettings();
      });
    }
    const btnHistory = document.getElementById('btnHistory');
    if (btnHistory) {
      btnHistory.addEventListener('click', () => display.showHistory());
    }
    const btnLog = document.getElementById('btnLog');
    if (btnLog) {
      btnLog.addEventListener('click', () => display.showLogPanel());
    }
    const btnGoSettings = document.getElementById('btnGoSettings');
    if (btnGoSettings) {
      btnGoSettings.addEventListener('click', () => {
        if (window.PMM.settingsPanel && window.PMM.settingsPanel.applySettingsToUI) {
          window.PMM.settingsPanel.applySettingsToUI(state.currentSettings);
        }
        display.showSettings();
      });
    }
    const btnRetry = document.getElementById('btnRetry');
    if (btnRetry) {
      btnRetry.addEventListener('click', () => display.refreshUsageDisplay(true));
    }
    const btnViewLog = document.getElementById('btnViewLog');
    if (btnViewLog) {
      btnViewLog.addEventListener('click', () => display.showLogPanel());
    }

    init();
  });
})();