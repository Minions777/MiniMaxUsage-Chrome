// MiniMax Token Monitor - Background Service Worker

const STORAGE_KEYS = {
  API_KEY: 'minimax_api_key',
  ENDPOINT: 'minimax_endpoint',
  AUTO_REFRESH_INTERVAL: 'minimax_auto_refresh_interval',
  AUTO_REFRESH_ENABLED: 'minimax_auto_refresh_enabled',
  HISTORY: 'minimax_usage_history',
  LAST_USAGE: 'minimax_last_usage'
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

    if (data.code !== 0) {
      throw new Error(data.msg || 'API Error');
    }

    const usage = {
      used: data.data.used,
      remains: data.data.remains,
      total: data.data.total,
      resetTime: data.data.resetTime,
      planType: data.data.planType
    };

    // 保存最新用量
    await chrome.storage.local.set({ [STORAGE_KEYS.LAST_USAGE]: usage });

    // 添加历史记录
    await addHistoryRecord(usage);

    // 更新 badge
    updateBadge(usage);

    return usage;
  } catch (error) {
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
    case 'START_AUTO_REFRESH':
      startAutoRefresh().then(sendResponse);
      return true;
  }
});

// 初始化
(async () => {
  const settings = await getSettings();
  if (settings.apiKey) {
    // 首次获取用量
    const usage = await fetchUsage();
    // 启动自动刷新
    await startAutoRefresh();
  }
})();
