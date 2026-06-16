// MiniMax Token Monitor - Popup Script

let currentSettings = null;
let currentTheme = 'neon';
let isRefreshing = false;

// DOM Elements
const loading = document.getElementById('loading');
const mainContent = document.getElementById('mainContent');
const emptyState = document.getElementById('emptyState');
const usageSection = document.getElementById('usageSection');
const errorState = document.getElementById('errorState');
const settingsPanel = document.getElementById('settingsPanel');
const historyPanel = document.getElementById('historyPanel');
const logPanel = document.getElementById('logPanel');
const logList = document.getElementById('logList');
const refreshOverlay = document.getElementById('refreshOverlay');

// Ring elements
const ringProgress = document.getElementById('ringProgress');
const ringPercent = document.getElementById('ringPercent');
const statUsed = document.getElementById('statUsed');
const statRemains = document.getElementById('statRemains');
const statTotal = document.getElementById('statTotal');
const intervalResetTime = document.getElementById('intervalResetTime');
const statWeeklyRemains = document.getElementById('statWeeklyRemains');
const statWeeklyTotal = document.getElementById('statWeeklyTotal');
const lastUpdated = document.getElementById('lastUpdated');
const endpointLabel = document.getElementById('endpointLabel');
const refreshText = document.getElementById('refreshText');
const errorMessage = document.getElementById('errorMessage');

// Token stats elements
const statYesterday = document.getElementById('statYesterday');
const statSevenDay = document.getElementById('statSevenDay');
const statMonth = document.getElementById('statMonth');

// Subscription elements
const subscriptionGroup = document.getElementById('subscriptionGroup');
const subscriptionDays = document.getElementById('subscriptionDays');

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

function formatDate(timestamp) {
  const d = new Date(timestamp);
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${month}/${day}`;
}

// M3: 颜色逻辑反转 - 现在传入的是"剩余%"（0-1），剩得多绿色，剩得少红色
// isWeekly=true 时使用本周限额的配色（蓝紫色系）
function colorForPercentage(remainingPct, isWeekly = false) {
  if (isWeekly) {
    // 本周限额配色：使用蓝紫色系渐变
    return { color: '#4facfe', gradient: 'url(#weeklyGradient)', shadow: 'rgba(79, 172, 254, 0.4)' };
  }
  // 5小时限额配色：使用主题色
  if (remainingPct >= 0.6) return { color: 'var(--accent)', gradient: 'url(#greenGradient)', shadow: 'var(--accent-glow)' };
  if (remainingPct >= 0.3) return { color: 'var(--orange-color)', gradient: 'url(#orangeGradient)', shadow: 'rgba(245, 166, 35, 0.4)' };
  return { color: 'var(--red-color)', gradient: 'url(#redGradient)', shadow: 'rgba(255, 107, 107, 0.4)' };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
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

  // Load cached usage data (don't fetch on open)
  const cached = await chrome.runtime.sendMessage({ type: 'GET_USAGE' });
  if (cached && !cached.error) {
    displayUsage(cached);
  } else if (cached?.error === 'NO_API_KEY') {
    showEmpty();
    showMain();
    return;
  }

  showMain();
}

// Refresh usage from background
async function refreshUsageDisplay() {
  if (!currentSettings) {
    currentSettings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  }

  if (!currentSettings.apiKey) {
    showEmpty();
    return;
  }

  let result;
  try {
    result = await chrome.runtime.sendMessage({ type: 'GET_USAGE' });
  } catch (e) {
    showError('获取用量失败，请稍后重试');
    return;
  }

  if (!result) {
    showError('获取用量失败，请稍后重试');
    return;
  }

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

// Display usage data（M3: 显示剩余%，颜色逻辑反转）
function displayUsage(usage) {
  // M3: 使用 remaining_percent（剩余百分比）
  const total = usage.intervalTotal || 1;
  const remainingPct = usage.intervalRemainingPercent != null
    ? usage.intervalRemainingPercent / 100
    : (total > 0 ? usage.intervalRemains / total : 0);

  const circumference = 2 * Math.PI * 50;
  // M3: 进度条显示"剩余%"（圆环从满到空）
  const offset = circumference * (1 - remainingPct);

  ringProgress.style.strokeDasharray = circumference;
  ringProgress.style.strokeDashoffset = offset;
  const colorInfo = colorForPercentage(remainingPct);
  ringProgress.style.stroke = colorInfo.gradient;
  ringProgress.style.filter = `drop-shadow(0 0 6px ${colorInfo.shadow})`;

  // M3: 显示剩余百分比
  ringPercent.textContent = Math.round(remainingPct * 100) + '%';
  ringPercent.style.color = colorInfo.color;
  ringPercent.style.textShadow = `0 0 10px ${colorInfo.shadow}`;

  // M3: 显示剩余次数和总额
  statUsed.textContent = formatNumber(usage.intervalRemains);
  statTotal.textContent = formatNumber(total);

  // 本周 Ring（M3: 使用 remaining_percent 剩余百分比）
  // 字段语义：weeklyRemainingPercent 是已被 background.js 反转过的"剩余%"（0-100）
  const weeklyRemainingPct = usage.weeklyRemainingPercent != null
    ? usage.weeklyRemainingPercent / 100
    : (usage.weeklyTotal > 0 ? usage.weeklyRemains / usage.weeklyTotal : 0);

  const weeklyCircumference = 2 * Math.PI * 50;
  const weeklyOffset = weeklyCircumference * (1 - weeklyRemainingPct);
  const weeklyRing = document.getElementById('weeklyRingProgress');
  const weeklyColorInfo = colorForPercentage(weeklyRemainingPct, true);  // 使用本周限额配色

  weeklyRing.style.strokeDasharray = weeklyCircumference;
  weeklyRing.style.strokeDashoffset = weeklyOffset;
  weeklyRing.style.stroke = weeklyColorInfo.gradient;
  weeklyRing.style.filter = `drop-shadow(0 0 6px ${weeklyColorInfo.shadow})`;

  document.getElementById('weeklyRingPercent').textContent = Math.round(weeklyRemainingPct * 100) + '%';
  document.getElementById('weeklyRingPercent').style.color = weeklyColorInfo.color;
  document.getElementById('weeklyRingPercent').style.textShadow = `0 0 10px ${weeklyColorInfo.shadow}`;

  // M3: 显示周限额剩余次数和总额（不再使用魔法倍数）
  document.getElementById('statWeeklyRemains').textContent = formatNumber(usage.weeklyRemains);
  document.getElementById('statWeeklyTotal').textContent = formatNumber(usage.weeklyTotal);
  document.getElementById('statWeeklyRemainsCard').textContent = formatNumber(usage.weeklyRemains);

  // 重置时间
  intervalResetTime.textContent = usage.intervalResetTimeStr || '--';

  // Token 消耗统计
  if (usage.tokenStats) {
    statYesterday.textContent = formatTokensCN(usage.tokenStats.yesterday);
    statSevenDay.textContent = formatTokensCN(usage.tokenStats.sevenDay);
    statMonth.textContent = formatTokensCN(usage.tokenStats.month);
  } else {
    statYesterday.textContent = '--';
    statSevenDay.textContent = '--';
    statMonth.textContent = '--';
  }

  // 订阅到期
  if (usage.subscription && usage.subscription.daysUntilEnd != null && usage.subscription.daysUntilEnd > 0) {
    subscriptionGroup.style.display = 'flex';
    subscriptionDays.textContent = usage.subscription.daysUntilEnd;
  } else {
    subscriptionGroup.style.display = 'none';
  }

  const now = new Date();
  lastUpdated.textContent = '更新于 ' + formatTime(now);

  const endpointName = currentSettings.endpoint === 'china' ? '🇨🇳' : '🌏';
  endpointLabel.textContent = currentSettings.endpoint + ' · ' + endpointName;

  const interval = currentSettings.autoRefreshInterval || 60;
  refreshText.textContent = `自动刷新中 · 每 ${interval}s`;

  showUsage();
}

// 格式化 Token 数字为中文显示
function formatTokensCN(tokens) {
  if (tokens >= 100000000) return `${(tokens / 100000000).toFixed(1)}亿`;
  if (tokens >= 10000) return `${(tokens / 10000).toFixed(1)}万`;
  return tokens.toString();
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
  logPanel.style.display = 'none';
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
  logPanel.style.display = 'none';
  loadHistoryData();
}

function showLogPanel() {
  loading.style.display = 'none';
  mainContent.style.display = 'none';
  settingsPanel.style.display = 'none';
  historyPanel.style.display = 'none';
  logPanel.style.display = 'flex';
  loadLogData();
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

// Event Listeners - Header (with debounce on refresh)
document.getElementById('btnRefresh').addEventListener('click', async () => {
  if (isRefreshing) return;
  isRefreshing = true;
  const btn = document.getElementById('btnRefresh');
  btn.classList.add('spinning');

  // 显示加载中覆盖层
  if (refreshOverlay) {
    refreshOverlay.style.display = 'flex';
  }

  try {
    await refreshUsageDisplay();
  } finally {
    btn.classList.remove('spinning');
    isRefreshing = false;
    if (refreshOverlay) {
      refreshOverlay.style.display = 'none';
    }
  }
});

document.getElementById('btnSettings').addEventListener('click', () => {
  applySettingsToUI(currentSettings);
  showSettings();
});

document.getElementById('btnHistory').addEventListener('click', () => {
  showHistory();
});

document.getElementById('btnLog').addEventListener('click', () => {
  showLogPanel();
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
    endpoint: document.querySelector('input[name="endpoint"]:checked')?.value ?? 'china',
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

// Interval button selection
document.querySelectorAll('.interval-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.interval-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// Endpoint option click - toggle selection (独立于 interval-btn)
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

document.getElementById('btnBackFromLog').addEventListener('click', () => {
  showMain();
});

document.getElementById('btnClearLog').addEventListener('click', async () => {
  if (confirm('确定清空所有日志？')) {
    await chrome.runtime.sendMessage({ type: 'CLEAR_LOGS' });
    loadLogData();
  }
});

// Load log data
async function loadLogData() {
  const logs = await chrome.runtime.sendMessage({ type: 'GET_LOGS' });

  if (!logs || logs.length === 0) {
    logList.innerHTML = '<div class="log-empty">暂无日志记录</div>';
    return;
  }

  const recent = logs.slice(0, 100);
  logList.innerHTML = recent.map(log => {
    const time = new Date(log.timestamp);
    const timeStr = `${time.getHours().toString().padStart(2,'0')}:${time.getMinutes().toString().padStart(2,'0')}:${time.getSeconds().toString().padStart(2,'0')}`;
    const typeClass = log.type === 'error' ? 'log-type-error' : log.type === 'success' ? 'log-type-success' : log.type === 'warn' ? 'log-type-warn' : 'log-type-info';
    const typeLabel = log.type === 'error' ? '错误' : log.type === 'success' ? '成功' : log.type === 'warn' ? '警告' : '信息';
    return `
      <div class="log-item">
        <div class="log-item-header">
          <span class="log-entry-time">${escapeHtml(timeStr)}</span>
          <span class="log-entry-type ${typeClass}">${typeLabel}</span>
        </div>
        <div class="log-entry-msg">${escapeHtml(log.message)}</div>
      </div>
    `;
  }).join('');
}

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
        <div class="bar-date">${escapeHtml(formatDate(day.date))}</div>
        <div class="bar-value">${escapeHtml(formatNumber(dailyUsed))}</div>
      </div>
    `;
  }).join('');
}

function renderHistoryList(days) {
  historyList.innerHTML = days.map((day, dayIndex) => {
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
          <span style="color:var(--text-muted)">${escapeHtml(formatTime(new Date(record.timestamp)))}</span>
          <span>已用 ${escapeHtml(formatNumber(record.used))}</span>
          <span>剩余 ${escapeHtml(formatNumber(record.remains))}</span>
          <span class="history-record-dot" style="background:${colorInfo.color}"></span>
        </div>
      `;
    }).join('');

    return `
      <div class="history-day" data-day-index="${dayIndex}">
        <div class="history-day-header">
          <div class="history-day-left">
            <span class="history-day-weekday">${escapeHtml(weekday)}</span>
            <span class="history-day-date">${escapeHtml(dateStr)}</span>
          </div>
          <div class="history-day-right">
            <span class="history-day-used">-${escapeHtml(formatNumber(dailyUsed))}</span>
            <span class="history-day-records">${day.records.length}条</span>
            <span class="history-day-expand">▶</span>
          </div>
        </div>
        <div class="history-day-detail">${details}</div>
      </div>
    `;
  }).join('');
}

// Event delegation for history day expand/collapse (替代 inline onclick)
historyList.addEventListener('click', (e) => {
  const header = e.target.closest('.history-day-header');
  if (!header) return;
  const detail = header.parentElement.querySelector('.history-day-detail');
  if (detail) detail.classList.toggle('show');
});

// Boot
document.addEventListener('DOMContentLoaded', init);
