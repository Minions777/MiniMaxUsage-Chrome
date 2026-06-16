// MiniMax Token Monitor - Settings panel
// Owns: applySettingsToUI, save flow, interval/theme/endpoint selection.

(function () {
  'use strict';

  const { state, dom, initDom } = window.PMM;
  const { display } = window.PMM;

  function applySettingsToUI(settings) {
    initDom();
    dom.inputAPIKey.value = settings.apiKey || '';
    dom.toggleAutoRefresh.checked = settings.autoRefreshEnabled !== false;
    dom.toggleNotifications.checked = settings.notificationsEnabled !== false;
    dom.inputNotifyThreshold.value = settings.notifyThreshold ?? 10;

    document.querySelectorAll('input[name="endpoint"]').forEach(radio => {
      radio.checked = radio.value === (settings.endpoint || 'china');
    });
    document.querySelectorAll('#settingsPanel .endpoint-option').forEach(opt => {
      opt.classList.toggle('selected', opt.querySelector('input').checked);
    });
    document.querySelectorAll('.interval-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.value) === (settings.autoRefreshInterval || 60));
    });
    dom.intervalField.style.display = dom.toggleAutoRefresh.checked ? 'block' : 'none';
  }

  async function save() {
    initDom();
    const threshold = parseInt(dom.inputNotifyThreshold.value, 10);
    const settings = {
      apiKey: dom.inputAPIKey.value.trim(),
      endpoint: document.querySelector('input[name="endpoint"]:checked')?.value ?? 'china',
      autoRefreshEnabled: dom.toggleAutoRefresh.checked,
      autoRefreshInterval: parseInt(document.querySelector('.interval-btn.active')?.dataset.value || '60'),
      notificationsEnabled: dom.toggleNotifications.checked,
      notifyThreshold: Number.isFinite(threshold) ? Math.max(1, Math.min(50, threshold)) : 10,
    };
    await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings });
    state.currentSettings = settings;
    await display.refreshUsageDisplay();
    display.showMain();
  }

  function bind() {
    initDom();

    dom.toggleAutoRefresh.addEventListener('change', () => {
      dom.intervalField.style.display = dom.toggleAutoRefresh.checked ? 'block' : 'none';
    });

    dom.inputAPIKey.parentElement.querySelector('#btnToggleKey')
      .addEventListener('click', () => {
        const isPassword = dom.inputAPIKey.type === 'password';
        dom.inputAPIKey.type = isPassword ? 'text' : 'password';
        const btn = document.getElementById('btnToggleKey');
        if (btn) btn.textContent = isPassword ? '🙈' : '👁';
      });

    document.querySelectorAll('.interval-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.interval-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    document.querySelectorAll('#settingsPanel .endpoint-option').forEach(option => {
      option.addEventListener('click', () => {
        document.querySelectorAll('#settingsPanel .endpoint-option').forEach(opt => {
          opt.classList.remove('selected');
          const r = opt.querySelector('input[type="radio"]');
          if (r) r.checked = false;
        });
        const radio = option.querySelector('input[type="radio"]');
        if (radio) {
          radio.checked = true;
          option.classList.add('selected');
        }
      });
    });

    document.querySelectorAll('.theme-option').forEach(option => {
      option.addEventListener('click', () => {
        const themeId = option.dataset.theme;
        state.currentTheme = themeId;
        window.applyTheme(themeId);
        updateThemeUI(themeId);
        window.saveTheme(themeId);
      });
    });

    document.getElementById('btnBackFromSettings').addEventListener('click', async () => {
      await display.refreshUsageDisplay();
      display.showMain();
    });
    document.getElementById('btnSaveSettings').addEventListener('click', save);
  }

  function updateThemeUI(themeId) {
    document.querySelectorAll('.theme-option').forEach(opt => {
      opt.classList.toggle('selected', opt.dataset.theme === themeId);
    });
  }

  window.PMM.settingsPanel = { applySettingsToUI, bind };
})();