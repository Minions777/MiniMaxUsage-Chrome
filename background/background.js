// MiniMax Token Monitor - Background Service Worker

const STORAGE_KEYS = {
  API_KEY: 'minimax_api_key',
  ENDPOINT: 'minimax_endpoint',
  AUTO_REFRESH_INTERVAL: 'minimax_auto_refresh_interval',
  AUTO_REFRESH_ENABLED: 'minimax_auto_refresh_enabled',
  HISTORY: 'minimax_usage_history',
  LAST_USAGE: 'minimax_last_usage',
  LOGS: 'minimax_logs'
};

const ENDPOINTS = {
  china: {
    name: '🇨🇳 China',
    baseURL: 'https://www.minimaxi.com',
    remainsPath: '/v1/api/openplatform/coding_plan/remains'
  },
  international: {
    name: '🌏 International',
    baseURL: 'https://api.minimax.io',
    remainsPath: '/v1/api/openplatform/coding_plan/remains'
  }
};

// 获取设置（API Key 从 local 读取，其余从 sync 读取）
async function getSettings() {
  const [syncResult, localResult] = await Promise.all([
    chrome.storage.sync.get([
      STORAGE_KEYS.ENDPOINT,
      STORAGE_KEYS.AUTO_REFRESH_INTERVAL,
      STORAGE_KEYS.AUTO_REFRESH_ENABLED
    ]),
    chrome.storage.local.get([STORAGE_KEYS.API_KEY])
  ]);
  return {
    apiKey: localResult[STORAGE_KEYS.API_KEY] || '',
    endpoint: syncResult[STORAGE_KEYS.ENDPOINT] || 'china',
    autoRefreshInterval: syncResult[STORAGE_KEYS.AUTO_REFRESH_INTERVAL] || 60,
    autoRefreshEnabled: syncResult[STORAGE_KEYS.AUTO_REFRESH_ENABLED] !== false
  };
}

// 保存设置（API Key 存 local，其余存 sync）
async function saveSettings(settings) {
  await Promise.all([
    chrome.storage.sync.set({
      [STORAGE_KEYS.ENDPOINT]: settings.endpoint || 'china',
      [STORAGE_KEYS.AUTO_REFRESH_INTERVAL]: settings.autoRefreshInterval || 60,
      [STORAGE_KEYS.AUTO_REFRESH_ENABLED]: settings.autoRefreshEnabled !== false
    }),
    chrome.storage.local.set({
      [STORAGE_KEYS.API_KEY]: settings.apiKey || ''
    })
  ]);
}

// 获取历史记录
async function getHistory() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.HISTORY);
  return result[STORAGE_KEYS.HISTORY] || [];
}

// 保存历史记录（30 天过期 + 每天最多 24 条）
async function saveHistory(history) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const fresh = history.filter(r => r.timestamp > cutoff);

  // 每天最多保留 24 条：按天分组，每组只留最新 24 条
  const grouped = {};
  fresh.forEach(r => {
    const dayKey = new Date(r.timestamp).toDateString();
    if (!grouped[dayKey]) grouped[dayKey] = [];
    grouped[dayKey].push(r);
  });

  const limited = [];
  Object.values(grouped).forEach(dayRecords => {
    dayRecords.sort((a, b) => b.timestamp - a.timestamp);
    limited.push(...dayRecords.slice(0, 24));
  });
  limited.sort((a, b) => b.timestamp - a.timestamp);

  await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: limited });
}

// 添加历史记录
async function addHistoryRecord(usage) {
  const history = await getHistory();
  history.unshift({
    id: Date.now().toString(),
    timestamp: Date.now(),
    used: usage.used,
    remains: usage.remains,
    total: usage.total
  });
  await saveHistory(history);
}

// 日志相关
async function getLogs() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.LOGS);
  return result[STORAGE_KEYS.LOGS] || [];
}

async function saveLogs(logs) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const filtered = logs.filter(r => r.timestamp > cutoff).slice(-200);
  await chrome.storage.local.set({ [STORAGE_KEYS.LOGS]: filtered });
}

async function addLog(type, message) {
  const logs = await getLogs();
  logs.unshift({
    id: Date.now().toString(),
    timestamp: Date.now(),
    type: type,
    message: message
  });
  await saveLogs(logs);
}

// 获取最新用量
async function fetchUsage() {
  const settings = await getSettings();
  if (!settings.apiKey) {
    return { error: 'NO_API_KEY' };
  }

  const endpoint = ENDPOINTS[settings.endpoint];
  const url = endpoint.baseURL + endpoint.remainsPath;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${settings.apiKey}`,
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    const statusCode = data.base_resp?.status_code ?? data.code;
    const statusMsg = data.base_resp?.status_msg ?? data.msg;
    if (statusCode !== 0) {
      throw new Error(statusMsg || 'API Error');
    }

    const models = data.model_remains || [];

    if (models.length === 0) {
      throw new Error('无模型数据');
    }

    const codingModels = models.filter(m =>
      m.model_name?.includes('MiniMax-M') ||
      m.model_name?.includes('coding-plan')
    );
    const targetModels = codingModels.length > 0 ? codingModels : models;

    let totalUsed = 0;
    let totalRemains = 0;
    let totalAll = 0;

    targetModels.forEach(m => {
      const intervalTotal = m.current_interval_total_count || 0;
      const intervalUsed = m.current_interval_usage_count || 0;
      totalUsed += intervalTotal - intervalUsed;
      totalRemains += intervalUsed;
      totalAll += intervalTotal;
    });

    const usage = {
      intervalUsed: totalUsed,
      intervalRemains: totalRemains,
      intervalTotal: totalAll,
      intervalResetTime: targetModels[0]?.remains_time || null,
      weeklyUsed: targetModels.reduce((s, m) => s + (m.current_weekly_total_count - m.current_weekly_usage_count), 0),
      weeklyRemains: targetModels.reduce((s, m) => s + (m.current_weekly_usage_count || 0), 0),
      weeklyTotal: targetModels.reduce((s, m) => s + (m.current_weekly_total_count || 0), 0),
      used: totalUsed,
      remains: totalRemains,
      total: totalAll,
      resetTime: targetModels[0]?.remains_time || null,
      planType: 'Coding Plan'
    };

    await chrome.storage.local.set({ [STORAGE_KEYS.LAST_USAGE]: usage });
    await addHistoryRecord(usage);
    await addLog('success', `获取用量成功 — 已用 ${usage.used} / 总计 ${usage.total}`);
    updateBadge(usage);

    return usage;
  } catch (error) {
    await addLog('error', `API 请求失败: ${error.message}`);
    return { error: error.message || 'NETWORK_ERROR' };
  }
}

// 更新扩展图标 badge
function updateBadge(usage) {
  if (!usage || usage.error) {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#ff7675' });
  } else {
    const pct = usage.total > 0 ? Math.round((usage.used / usage.total) * 100) : 0;
    chrome.action.setBadgeText({ text: pct + '%' });
    if (pct < 50) {
      chrome.action.setBadgeBackgroundColor({ color: '#00d09c' });
    } else if (pct < 80) {
      chrome.action.setBadgeBackgroundColor({ color: '#fdcb6e' });
    } else {
      chrome.action.setBadgeBackgroundColor({ color: '#ff7675' });
    }
  }
}

// 自动刷新：使用 chrome.alarms（MV3 持久化，最小间隔 1 分钟）
async function startAutoRefresh() {
  await chrome.alarms.clear('autoRefresh');
  const settings = await getSettings();
  if (!settings.autoRefreshEnabled || !settings.apiKey) return;

  // chrome.alarms 最小间隔 1 分钟，小于 60s 的设置向上取整
  const periodInMinutes = Math.max(1, settings.autoRefreshInterval / 60);
  chrome.alarms.create('autoRefresh', { periodInMinutes });
}

async function stopAutoRefresh() {
  await chrome.alarms.clear('autoRefresh');
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'autoRefresh') {
    await fetchUsage();
    // 通知 popup 刷新（popup 未打开时会静默失败）
    chrome.runtime.sendMessage({ type: 'USAGE_UPDATED' }).catch(() => {});
  }
});

// 监听消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'GET_USAGE':
      fetchUsage().then(sendResponse);
      return true;
    case 'GET_SETTINGS':
      getSettings().then(sendResponse);
      return true;
    case 'SAVE_SETTINGS':
      saveSettings(message.settings).then(async () => {
        await startAutoRefresh();
        sendResponse({ success: true });
      });
      return true;
    case 'GET_HISTORY':
      getHistory().then(sendResponse);
      return true;
    case 'CLEAR_HISTORY':
      chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: [] }).then(sendResponse);
      return true;
    case 'GET_LOGS':
      getLogs().then(sendResponse);
      return true;
    case 'CLEAR_LOGS':
      chrome.storage.local.set({ [STORAGE_KEYS.LOGS]: [] }).then(sendResponse);
      return true;
    case 'START_AUTO_REFRESH':
      startAutoRefresh().then(sendResponse);
      return true;
  }
});

// 初始化
(async () => {
  await addLog('info', 'MiniMax Token Monitor 已启动');
  const settings = await getSettings();
  if (settings.apiKey) {
    await fetchUsage();
    await startAutoRefresh();
  } else {
    await addLog('warn', '未配置 API Key，请先在设置中配置');
  }
})();
