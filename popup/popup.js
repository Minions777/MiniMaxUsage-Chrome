// MiniMax Token Monitor - Popup Script

let currentSettings = null;
let currentTheme = 'neon';

// DOM Elements
const loading = document.getElementById('loading');
const mainContent = document.getElementById('mainContent');
const emptyState = document.getElementById('emptyState');
const usageSection = document.getElementById('usageSection');
const errorState = document.getElementById('errorState');
const settingsPanel = document.getElementById('settingsPanel');
const historyPanel = document.getElementById('historyPanel');

// Ring elements
const ringProgress = document.getElementById('ringProgress');
const ringPercent = document.getElementById('ringPercent');
const statUsed = document.getElementById('statUsed');
const statRemains = document.getElementById('statRemains');
const statTotal = document.getElementById('statTotal');
const lastUpdated = document.getElementById('lastUpdated');
const endpointLabel = document.getElementById('endpointLabel');
const refreshIndicator = document.getElementById('refreshIndicator');
const refreshText = document.getElementById('refreshText');
const errorMessage = document.getElementById('errorMessage');

// Settings elements
const inputAPIKey = document.getElementById('inputAPIKey');
const toggleAutoRefresh = document.getElementById('toggleAutoRefresh');
const intervalField = document.getElementById('intervalField');

// History elements
const histAvg = document.getElementById('histAvg');
const histMax = document.getElementById('histMax');
const histDays = document.getElementById('histDays');
const weeklyChart = document.getElementById('weeklyChart');
const historyList = document.getElementById('historyList');

// Utility functions
function formatNumber(num) {
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
  return num.toString();
}

function formatTime(date) {
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function formatDate(timestamp) {
  const d = new Date(timestamp);
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${month}/${day}`;
}

function colorForPercentage(pct) {
  if (pct < 0.5) return { color: 'var(--accent)', gradient: 'url(#greenGradient)', shadow: 'var(--accent-glow)' };
  if (pct < 0.8) return { color: 'var(--orange-color)', gradient: 'url(#orangeGradient)', shadow: 'rgba(245, 166, 35, 0.4)' };
  return { color: 'var(--red-color)', gradient: 'url(#redGradient)', shadow: 'rgba(255, 107, 107, 0.4)' };
}

// Initialize
async function init() {
  showLoading();

  // Load theme first
  currentTheme = await getTheme();
  applyTheme(currentTheme);
  updateThemeUI(currentTheme);

  // Listen for updates from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'USAGE_UPDATED') {
      refreshUsageDisplay();
    }
  });

  // Load settings and display
  currentSettings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  applySettingsToUI(currentSettings);

  // Load and display usage
  await refreshUsageDisplay();

  showMain();
}

// Refresh usage from background
async function refreshUsageDisplay() {
  currentSettings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });

  if (!currentSettings.apiKey) {
    showEmpty();
    return;
  }

  const result = await chrome.runtime.sendMessage({ type: 'GET_USAGE' });

  if (result.error) {
    if (result.error === 'NO_API_KEY') {
      showEmpty();
    } else {
      showError(result.error);
    }
    return;
  }

  displayUsage(result);
}

// Display usage data
function displayUsage(usage) {
  const pct = usage.total > 0 ? usage.used / usage.total : 0;
  const circumference = 2 * Math.PI * 85; // r=85
  const offset = circumference * (1 - pct);

  ringProgress.style.strokeDasharray = circumference;
  ringProgress.style.strokeDashoffset = offset;
  const colorInfo = colorForPercentage(pct);
  ringProgress.style.stroke = colorInfo.gradient;
  ringProgress.style.filter = `drop-shadow(0 0 8px ${colorInfo.shadow})`;

  ringPercent.textContent = Math.round(pct * 100) + '%';
  ringPercent.style.color = colorInfo.color;
  ringPercent.style.textShadow = `0 0 20px ${colorInfo.shadow}`;

  statUsed.textContent = formatNumber(usage.used);
  statUsed.style.color = colorInfo.color;

  statRemains.textContent = formatNumber(usage.remains);
  statRemains.style.color = 'var(--text-primary)';

  statTotal.textContent = formatNumber(usage.total);

  const now = new Date();
  lastUpdated.textContent = '更新于 ' + formatTime(now);

  const endpointName = currentSettings.endpoint === 'china' ? '🇨🇳' : '🌏';
  endpointLabel.textContent = currentSettings.endpoint + ' · ' + endpointName;

  const interval = currentSettings.autoRefreshInterval || 60;
  refreshText.textContent = `自动刷新中 · 每 ${interval}s`;

  showUsage();
}

// UI State Management
function showLoading() {
  loading.style.display = 'flex';
  mainContent.style.display = 'none';
  settingsPanel.style.display = 'none';
  historyPanel.style.display = 'none';
}

function showMain() {
  loading.style.display = 'none';
  mainContent.style.display = 'flex';
  settingsPanel.style.display = 'none';
  historyPanel.style.display = 'none';
}

function showEmpty() {
  loading.style.display = 'none';
  mainContent.style.display = 'flex';
  emptyState.style.display = 'flex';
  usageSection.style.display = 'none';
  errorState.style.display = 'none';
}

function showUsage() {
  loading.style.display = 'none';
  mainContent.style.display = 'flex';
  emptyState.style.display = 'none';
  usageSection.style.display = 'flex';
  errorState.style.display = 'none';
}

function showError(err) {
  loading.style.display = 'none';
  mainContent.style.display = 'flex';
  emptyState.style.display = 'none';
  usageSection.style.display = 'none';
  errorState.style.display = 'flex';
  errorMessage.textContent = err;
}

function showSettings() {
  loading.style.display = 'none';
  mainContent.style.display = 'none';
  settingsPanel.style.display = 'flex';
  historyPanel.style.display = 'none';
}

function showHistory() {
  loading.style.display = 'none';
  mainContent.style.display = 'none';
  settingsPanel.style.display = 'none';
  historyPanel.style.display = 'flex';
  loadHistoryData();
}

// Apply settings to UI
function applySettingsToUI(settings) {
  inputAPIKey.value = settings.apiKey || '';
  toggleAutoRefresh.checked = settings.autoRefreshEnabled !== false;

  document.querySelectorAll('input[name="endpoint"]').forEach(radio => {
    radio.checked = radio.value === (settings.endpoint || 'china');
  });

  document.querySelectorAll('.interval-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.value) === (settings.autoRefreshInterval || 60));
  });

  intervalField.style.display = toggleAutoRefresh.checked ? 'block' : 'none';
}

// Event Listeners - Header
document.getElementById('btnRefresh').addEventListener('click', async () => {
  const btn = document.getElementById('btnRefresh');
  btn.classList.add('spinning');
  await refreshUsageDisplay();
  btn.classList.remove('spinning');
});

document.getElementById('btnSettings').addEventListener('click', () => {
  applySettingsToUI(currentSettings);
  showSettings();
});

document.getElementById('btnHistory').addEventListener('click', () => {
  showHistory();
});

document.getElementById('btnGoSettings').addEventListener('click', () => {
  applySettingsToUI(currentSettings);
  showSettings();
});

document.getElementById('btnRetry').addEventListener('click', async () => {
  await refreshUsageDisplay();
});

// Event Listeners - Settings
document.getElementById('btnBackFromSettings').addEventListener('click', async () => {
  await refreshUsageDisplay();
  showMain();
});

document.getElementById('btnSaveSettings').addEventListener('click', async () => {
  const settings = {
    apiKey: inputAPIKey.value.trim(),
    endpoint: document.querySelector('input[name="endpoint"]:checked').value,
    autoRefreshEnabled: toggleAutoRefresh.checked,
    autoRefreshInterval: parseInt(document.querySelector('.interval-btn.active')?.dataset.value || '60')
  };

  await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings });
  currentSettings = settings;

  await refreshUsageDisplay();
  showMain();
});

document.getElementById('btnToggleKey').addEventListener('click', () => {
  const isPassword = inputAPIKey.type === 'password';
  inputAPIKey.type = isPassword ? 'text' : 'password';
  document.getElementById('btnToggleKey').textContent = isPassword ? '🙈' : '👁';
});

toggleAutoRefresh.addEventListener('change', () => {
  intervalField.style.display = toggleAutoRefresh.checked ? 'block' : 'none';
});

document.querySelectorAll('.interval-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.interval-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// Theme selection
document.querySelectorAll('.theme-option').forEach(option => {
  option.addEventListener('click', () => {
    const themeId = option.dataset.theme;
    currentTheme = themeId;
    applyTheme(themeId);
    updateThemeUI(themeId);
    saveTheme(themeId);
  });
});

function updateThemeUI(themeId) {
  document.querySelectorAll('.theme-option').forEach(opt => {
    opt.classList.toggle('selected', opt.dataset.theme === themeId);
  });
}

// Event Listeners - History
document.getElementById('btnBackFromHistory').addEventListener('click', () => {
  showMain();
});

document.getElementById('btnClearHistory').addEventListener('click', async () => {
  if (confirm('确定清空所有历史记录？')) {
    await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
    loadHistoryData();
  }
});

// Load history data
async function loadHistoryData() {
  const history = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' });

  if (!history || history.length === 0) {
    histAvg.textContent = '--%';
    histMax.textContent = '--%';
    histDays.textContent = '0';
    weeklyChart.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:20px;">暂无数据</div>';
    historyList.innerHTML = '';
    return;
  }

  // Group by day
  const grouped = {};
  history.forEach(record => {
    const dateKey = new Date(record.timestamp).toDateString();
    if (!grouped[dateKey]) {
      grouped[dateKey] = {
        date: new Date(record.timestamp),
        records: []
      };
    }
    grouped[dateKey].records.push(record);
  });

  const days = Object.values(grouped).sort((a, b) => b.date - a.date);
  const last7 = days.slice(0, 7).reverse();

  // Stats
  if (days.length > 0) {
    const avgPct = days.reduce((sum, day) => {
      const dayPct = day.records.reduce((s, r) => s + (r.total > 0 ? r.used / r.total : 0), 0) / day.records.length;
      return sum + dayPct;
    }, 0) / days.length;

    const maxPct = Math.max(...days.map(day => {
      return Math.max(...day.records.map(r => r.total > 0 ? r.used / r.total : 0));
    }));

    histAvg.textContent = Math.round(avgPct * 100) + '%';
    histMax.textContent = Math.round(maxPct * 100) + '%';
    histDays.textContent = days.length.toString();
  }

  // Weekly chart
  renderWeeklyChart(last7);

  // History list
  renderHistoryList(days.slice(0, 14));
}

function renderWeeklyChart(days) {
  if (days.length === 0) {
    weeklyChart.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:20px;">数据不足</div>';
    return;
  }

  const maxUsed = Math.max(...days.map(d => {
    if (d.records.length < 2) return 0;
    return d.records[0].used - d.records[d.records.length - 1].used;
  }));

  weeklyChart.innerHTML = days.map(day => {
    let dailyUsed = 0;
    if (day.records.length >= 2) {
      dailyUsed = day.records[0].used - day.records[day.records.length - 1].used;
    }
    const height = maxUsed > 0 ? Math.max(4, (dailyUsed / maxUsed) * 50) : 4;
    return `
      <div class="bar-col">
        <div class="bar-bar" style="height:${height}px"></div>
        <div class="bar-date">${formatDate(day.date)}</div>
        <div class="bar-value">${formatNumber(dailyUsed)}</div>
      </div>
    `;
  }).join('');
}

function renderHistoryList(days) {
  historyList.innerHTML = days.map(day => {
    let dailyUsed = 0;
    if (day.records.length >= 2) {
      dailyUsed = day.records[0].used - day.records[day.records.length - 1].used;
    }

    const weekday = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][day.date.getDay()];
    const dateStr = formatDate(day.date);

    const details = day.records.map(record => {
      const pct = record.total > 0 ? record.used / record.total : 0;
      const colorInfo = colorForPercentage(pct);
      return `
        <div class="history-record">
          <span style="color:var(--text-muted)">${formatTime(new Date(record.timestamp))}</span>
          <span>已用 ${formatNumber(record.used)}</span>
          <span>剩余 ${formatNumber(record.remains)}</span>
          <span class="history-record-dot" style="background:${colorInfo.color}"></span>
        </div>
      `;
    }).join('');

    return `
      <div class="history-day">
        <div class="history-day-header" onclick="this.parentElement.querySelector('.history-day-detail').classList.toggle('show')">
          <div class="history-day-left">
            <span class="history-day-weekday">${weekday}</span>
            <span class="history-day-date">${dateStr}</span>
          </div>
          <div class="history-day-right">
            <span class="history-day-used">-${formatNumber(dailyUsed)}</span>
            <span class="history-day-records">${day.records.length}条</span>
            <span class="history-day-expand">▶</span>
          </div>
        </div>
        <div class="history-day-detail">${details}</div>
      </div>
    `;
  }).join('');
}

// Boot
document.addEventListener('DOMContentLoaded', init);
