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
    state.currentTheme = await getTheme();
    window.applyTheme(state.currentTheme);
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

    // Load settings and cached usage
    state.currentSettings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    window.PMM.settingsPanel.applySettingsToUI(state.currentSettings);

    const cached = await chrome.runtime.sendMessage({ type: 'GET_USAGE' });
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
    document.getElementById('btnRefresh').addEventListener('click', async () => {
      if (state.isRefreshing) return;
      state.isRefreshing = true;
      const btn = document.getElementById('btnRefresh');
      btn.classList.add('spinning');
      const overlay = document.getElementById('refreshOverlay');
      if (overlay) overlay.style.display = 'flex';
      try {
        await display.refreshUsageDisplay();
      } finally {
        btn.classList.remove('spinning');
        state.isRefreshing = false;
        if (overlay) overlay.style.display = 'none';
      }
    });
    document.getElementById('btnSettings').addEventListener('click', () => {
      window.PMM.settingsPanel.applySettingsToUI(state.currentSettings);
      display.showSettings();
    });
    document.getElementById('btnHistory').addEventListener('click', () => display.showHistory());
    document.getElementById('btnLog').addEventListener('click', () => display.showLogPanel());
    document.getElementById('btnGoSettings').addEventListener('click', () => {
      window.PMM.settingsPanel.applySettingsToUI(state.currentSettings);
      display.showSettings();
    });
    document.getElementById('btnRetry').addEventListener('click', () => display.refreshUsageDisplay());
    document.getElementById('btnViewLog').addEventListener('click', () => display.showLogPanel());

    init();
  });
})();