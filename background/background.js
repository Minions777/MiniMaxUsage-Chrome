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

let autoRefreshTimer = null;

// 获取设置
async function getSettings() {
  const result = await chrome.storage.sync.get([
    STORAGE_KEYS.API_KEY,
    STORAGE_KEYS.ENDPOINT,
    STORAGE_KEYS.AUTO_REFRESH_INTERVAL,
    STORAGE_KEYS.AUTO_REFRESH_ENABLED
  ]);
  return {
    apiKey: result[STORAGE_KEYS.API_KEY] || '',
    endpoint: result[STORAGE_KEYS.ENDPOINT] || 'china',
    autoRefreshInterval: result[STORAGE_KEYS.AUTO_REFRESH_INTERVAL] || 60,
    autoRefreshEnabled: result[STORAGE_KEYS.AUTO_REFRESH_ENABLED] !== false
  };
}

// 保存设置
async function saveSettings(settings) {
  await chrome.storage.sync.set({
    [STORAGE_KEYS.API_KEY]: settings.apiKey || '',
    [STORAGE_KEYS.ENDPOINT]: settings.endpoint || 'china',
    [STORAGE_KEYS.AUTO_REFRESH_INTERVAL]: settings.autoRefreshInterval || 60,
    [STORAGE_KEYS.AUTO_REFRESH_ENABLED]: settings.autoRefreshEnabled !== false
  });
}

// 获取历史记录
async function getHistory() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.HISTORY);
  return result[STORAGE_KEYS.HISTORY] || [];
}

// 保存历史记录
async function saveHistory(history) {
  // 最多保留 30 天，每天最多 24 条
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const filtered = history.filter(r => r.timestamp > cutoff);
  await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: filtered });
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
  // 最多保留 200 条
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

    // 支持两种响应格式：1) { base_resp: { status_code: 0 } } 2) { code: 0 }
    const statusCode = data.base_resp?.status_code ?? data.code;
    const statusMsg = data.base_resp?.status_msg ?? data.msg;
    if (statusCode !== 0) {
      throw new Error(statusMsg || 'API Error');
    }

    // API 返回 model_remains 数组，每个模型一条记录
    // 注意：current_interval 数据和官网不一致，改用 weekly 数据
    const models = data.model_remains || [];
    let weeklyUsed = 0;
    let weeklyTotal = 0;

    if (models.length > 0) {
      // 优先取 coding-plan 相关的模型（MiniMax-M* / coding-plan-*）
      const codingModels = models.filter(m =>
        m.model_name?.includes('MiniMax-M') ||
        m.model_name?.includes('coding-plan')
      );
      const targetModels = codingModels.length > 0 ? codingModels : models;

      targetModels.forEach(m => {
        // 使用 weekly 数据（更接近官网显示）
        weeklyUsed += m.current_weekly_usage_count || 0;
        weeklyTotal += m.current_weekly_total_count || 0;
      });
    }

    const usage = {
      used: weeklyUsed,
      remains: Math.max(0, weeklyTotal - weeklyUsed),
      total: weeklyTotal,
      resetTime: null,
      planType: 'Coding Plan'
    };

    // 保存最新用量
    await chrome.storage.local.set({ [STORAGE_KEYS.LAST_USAGE]: usage });

    // 添加历史记录
    await addHistoryRecord(usage);

    // 记录成功日志
    await addLog('success', `获取用量成功 — 已用 ${usage.used} / 总计 ${usage.total}`);

    // 更新 badge
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

// 启动自动刷新
async function startAutoRefresh() {
  stopAutoRefresh();
  const settings = await getSettings();
  if (!settings.autoRefreshEnabled || !settings.apiKey) return;

  autoRefreshTimer = setInterval(async () => {
    await fetchUsage();
    // 通知所有 popup 刷新
    chrome.runtime.sendMessage({ type: 'USAGE_UPDATED' });
  }, settings.autoRefreshInterval * 1000);
}

// 停止自动刷新
function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

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
    // 首次获取用量
    const usage = await fetchUsage();
    // 启动自动刷新
    await startAutoRefresh();
  } else {
    await addLog('warn', '未配置 API Key，请先在设置中配置');
  }
})();
