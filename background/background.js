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
    remainsPath: '/v1/api/openplatform/coding_plan/remains',
    subscriptionPath: '/v1/api/openplatform/charge/combo/cycle_audio_resource_package?biz_line=2&cycle_type=1&resource_package_type=7',
    billingPath: '/account/amount'
  },
  international: {
    name: '🌏 International',
    baseURL: 'https://api.minimax.io',
    remainsPath: '/v1/api/openplatform/coding_plan/remains',
    subscriptionPath: '/v1/api/openplatform/charge/combo/cycle_audio_resource_package?biz_line=2&cycle_type=1&resource_package_type=7',
    billingPath: '/account/amount'
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
    used: usage.intervalUsed,
    remains: usage.intervalRemains,
    total: usage.intervalTotal
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

// 获取订阅信息
async function fetchSubscription(apiKey, endpoint) {
  try {
    const url = endpoint.baseURL + endpoint.subscriptionPath;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);  // 10秒超时

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const data = await response.json();
    return data.current_subscribe || null;
  } catch (error) {
    return null;
  }
}

// 获取所有账单记录（分页获取最多30天）
async function fetchAllBillingRecords(apiKey, endpoint) {
  const allRecords = [];
  let page = 1;
  const limit = 100;
  const maxPages = 30;  // 最多30页，防止无限循环
  const minStartTime = Date.now() - 30 * 24 * 60 * 60 * 1000;

  while (page <= maxPages) {
    try {
      const url = `${endpoint.baseURL}${endpoint.billingPath}?page=${page}&limit=${limit}&aggregate=false`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);  // 每页10秒超时

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) break;

      const data = await response.json();
      const records = data.charge_records || [];

      if (records.length === 0) break;

      for (const r of records) {
        const ts = r.created_at * 1000;
        if (minStartTime && ts < minStartTime) return allRecords;
        allRecords.push(r);
      }

      if (records.length < limit) break;
      page++;
    } catch {
      break;
    }
  }

  return allRecords;
}

// 计算 Token 消耗统计
function calculateTokenStats(records) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const sevenDaysAgo = now.getTime() - 7 * 86400000;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  let yesterdayTokens = 0;
  let sevenDayTokens = 0;
  let monthTokens = 0;

  for (const r of records) {
    const ts = r.created_at * 1000;
    const token = Number(r.consume_token);

    if (ts >= todayStart - 86400000 && ts < todayStart) {
      yesterdayTokens += token;
    }
    if (ts >= sevenDaysAgo) {
      sevenDayTokens += token;
    }
    if (ts >= monthStart) {
      monthTokens += token;
    }
  }

  return { yesterdayTokens, sevenDayTokens, monthTokens };
}

// 计算距离天数
function daysUntil(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    return null;
  }
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 86400000));
}

// M3: 格式化相对时间倒计时（接受毫秒数）
function formatResetCountdownMs(ms) {
  if (!ms || ms <= 0) return '--';

  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);

  if (h > 0) {
    return m > 0 ? `${h} 小时 ${m} 分钟后重置` : `${h} 小时后重置`;
  }
  return `${m} 分钟后重置`;
}

// 获取最新用量（适配 M3 Token Plan）
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

    // 分离主模型（MiniMax-M*）和其他模型
    const mainModel = models.find(m => m.model_name?.startsWith('MiniMax-M'))
      || models.find(m => m.current_interval_total_count > 0)
      || models[0];

    // M3 API 字段语义：
    // - current_interval_usage_count = 已使用次数
    // - current_interval_remaining_percent = 命名反向，实际是"已用%"（92 表示已用 92%）
    // - 显示"剩余%" = 100 - remaining_percent
    const intervalTotal = mainModel.current_interval_total_count || 0;
    const intervalUsedCount = mainModel.current_interval_usage_count || 0;  // 已使用次数
    const intervalRemains = intervalTotal - intervalUsedCount;  // 剩余次数 = 总数 - 已用

    // M3: remaining_percent 命名反向，100 - remainingPct 才是真正的"剩余%"
    const intervalRemainingPct = mainModel.current_interval_remaining_percent;
    const intervalRemainingPercent = (intervalRemainingPct !== undefined && intervalRemainingPct !== null)
      ? Math.round(100 - intervalRemainingPct)  // 反转：remaining_percent=92 表示已用 92%，剩余 8%
      : (intervalTotal > 0 ? Math.round((intervalRemains / intervalTotal) * 100) : null);

    // M3: remains_time 是相对时间（毫秒），需要计算绝对时间
    const intervalResetMs = mainModel.remains_time || 0;
    const intervalResetTime = intervalResetMs > 0 ? Date.now() + intervalResetMs : null;

    // M3 新增：时间窗口
    const startTime = mainModel.start_time || null;
    const endTime = mainModel.end_time || null;

    // 周限额
    const weeklyTotal = mainModel.current_weekly_total_count || 0;
    const weeklyUsedCount = mainModel.current_weekly_usage_count || 0;  // 已使用次数
    const weeklyRemains = weeklyTotal - weeklyUsedCount;  // 剩余次数

    // M3: weekly_remaining_percent 同样需要反转
    const weeklyRemainingPct = mainModel.current_weekly_remaining_percent;
    const weeklyRemainingPercent = (weeklyRemainingPct !== undefined && weeklyRemainingPct !== null)
      ? Math.round(100 - weeklyRemainingPct)  // 反转
      : (weeklyTotal > 0 ? Math.round((weeklyRemains / weeklyTotal) * 100) : null);

    // M3: weekly_remains_time 是相对时间（毫秒）
    const weeklyResetMs = mainModel.weekly_remains_time || 0;
    const weeklyResetTime = weeklyResetMs > 0 ? Date.now() + weeklyResetMs : null;

    // 获取订阅信息和 Token 消耗统计（并行请求）
    let subscription = null;
    let billingRecords = [];

    try {
      const results = await Promise.allSettled([
        fetchSubscription(settings.apiKey, endpoint),
        fetchAllBillingRecords(settings.apiKey, endpoint)
      ]);

      if (results[0].status === 'fulfilled' && results[0].value) {
        subscription = results[0].value;
      }

      if (results[1].status === 'fulfilled') {
        billingRecords = results[1].value;
      }
    } catch {
      // 静默失败，不影响主要功能
    }

    const tokenStats = calculateTokenStats(billingRecords);

    const usage = {
      // 5小时窗口配额
      intervalUsed: intervalUsedCount,  // 已使用次数
      intervalRemains,                  // 剩余次数
      intervalTotal,                    // 总次数
      intervalRemainingPercent,         // M3: 剩余百分比（已反转）
      intervalResetTime,
      intervalResetMs,                  // M3: 重置倒计时（毫秒）

      // 时间窗口（M3 新增）
      windowStartTime: startTime,
      windowEndTime: endTime,

      // 周限额
      weeklyUsed: weeklyUsedCount,      // 已使用次数
      weeklyRemains,                    // 剩余次数
      weeklyTotal,                      // 总次数
      weeklyRemainingPercent,           // M3: 剩余百分比（已反转）
      weeklyResetTime,
      weeklyResetMs,                    // M3: 重置倒计时（毫秒）

      // Token 消耗统计
      tokenStats: {
        yesterday: tokenStats.yesterdayTokens,
        sevenDay: tokenStats.sevenDayTokens,
        month: tokenStats.monthTokens
      },

      // 订阅信息
      subscription: subscription ? {
        endTime: subscription.current_subscribe_end_time,
        creditReloadTime: subscription.current_credit_reload_time,
        daysUntilEnd: daysUntil(new Date(subscription.current_subscribe_end_time))
      } : null,

      // 格式化后的重置时间字符串
      intervalResetTimeStr: formatResetCountdownMs(intervalResetMs),
      weeklyResetTimeStr: formatResetCountdownMs(weeklyResetMs)
    };

    await chrome.storage.local.set({ [STORAGE_KEYS.LAST_USAGE]: usage });
    await addHistoryRecord(usage);
    await addLog('success', `获取用量成功 — 剩余 ${intervalRemains} / 总计 ${intervalTotal} (${intervalRemainingPercent ?? '--'}%)`);
    updateBadge(usage);

    return usage;
  } catch (error) {
    await addLog('error', `获取用量失败: ${error.message}`);
    return { error: error.message || 'NETWORK_ERROR' };
  }
}

// 更新扩展图标 badge（M3: 显示剩余%，颜色逻辑反转）
function updateBadge(usage) {
  if (!usage || usage.error) {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#ff7675' });
  } else {
    // M3: 使用 remaining_percent（剩余百分比）
    const remainingPct = usage.intervalRemainingPercent ?? (
      usage.intervalTotal > 0 ? Math.round((usage.intervalRemains / usage.intervalTotal) * 100) : 0
    );
    chrome.action.setBadgeText({ text: remainingPct + '%' });

    // M3 颜色逻辑：剩得多绿色，剩得少红色
    if (remainingPct >= 60) {
      chrome.action.setBadgeBackgroundColor({ color: '#00d09c' });
    } else if (remainingPct >= 30) {
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

  const periodInMinutes = Math.max(1, settings.autoRefreshInterval / 60);
  chrome.alarms.create('autoRefresh', { periodInMinutes });
}

async function stopAutoRefresh() {
  await chrome.alarms.clear('autoRefresh');
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'autoRefresh') {
    await fetchUsage();
    chrome.runtime.sendMessage({ type: 'USAGE_UPDATED' }).catch(() => {});
  }
});

// 监听消息
// 获取缓存的用量数据
async function getCachedUsage() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.LAST_USAGE);
  return result[STORAGE_KEYS.LAST_USAGE] || null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'GET_USAGE':
      // 返回缓存数据，不主动刷新
      getCachedUsage().then(sendResponse);
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
  const settings = await getSettings();
  if (settings.apiKey) {
    await fetchUsage();
    await startAutoRefresh();
  }
})();