# MiniMax Token Monitor (Chrome Extension)

🎨 一个精美的 Chrome 浏览器插件，实时监控 MiniMax API 使用量，支持动画进度条和历史记录。

![Chrome Web Store](https://img.shields.io/badge/Chrome-v3.1-blue)
![Platform](https://img.shields.io/badge/platform-Chrome%20%2B%20Edge-green)
![MiniMax-M3](https://img.shields.io/badge/MiniMax-M3%20Ready-green)

---

## ✨ 功能特性

### 核心监控
- 📊 **实时监控** — Token 用量实时更新，带动画环形进度条
- 🌈 **颜色提示** — 剩余充足显示绿色，不足显示红色（M3 新逻辑）
- 🔔 **Badge 提醒** — 工具栏图标实时显示剩余百分比

### 双窗口配额（M3 适配）
- ⏱️ **5小时滚动窗口** — MiniMax-M 系列模型的 5 小时用量窗口
- 📅 **周限额** — 本周用量统计（周一零点重置）
- 🔢 **直观数字** — 剩余 / 总额双点显示（M3: 使用 remaining_percent）
- 🕐 **时间窗口** — 显示当前配额周期的时间范围

### Token 消耗统计
- 📆 **昨日消耗** — 昨日 Token 消耗量
- 📈 **近7天** — 近7天累计消耗
- 📆 **当月** — 当月累计消耗

### 订阅与到期
- ⏳ **订阅到期倒计时** — 显示距到期剩余天数
- 🔄 **重置时间** — 下次配额重置倒计时

### 扩展功能
- 🇨🇳 **双端点支持** — 中国区（minimaxi.com）和国际区（minimax.io）
- 🔐 **安全存储** — API Key 存储在本地 Chrome Storage，不上传任何服务器
- ⏰ **自动刷新** — 可配置刷新间隔（10秒 ~ 10分钟），使用 chrome.alarms 持久化
- 📈 **历史记录** — 记录每日用量，查看近 7 天柱状图和历史明细

---

## 📁 项目结构

```
MiniMaxUsage-Chrome/
├── manifest.json          # 插件配置 (Manifest V3)
├── background/
│   └── background.js      # Service Worker（API 请求 + 自动刷新 + 存储）
├── popup/
│   ├── popup.html         # 弹出窗口界面
│   ├── popup.css          # 样式 (CSS 变量主题系统)
│   ├── popup.js           # 交互逻辑
│   └── themes.js          # 主题系统 (5 种主题)
├── icons/                 # 插件图标
└── README.md
```

---

## 🔑 API 技术实现

### API 端点

插件调用以下 MiniMax API：

#### 1. 配额查询（主要）
```
GET https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

**响应字段解析（M3 更新）：**
```javascript
{
  "base_resp": { "status_code": 0, "status_msg": "success" },
  "model_remains": [
    {
      "model_name": "MiniMax-M3",
      "current_interval_total_count": 1500,           // 5小时窗口总额
      "current_interval_usage_count": 1200,           // 剩余（兼容旧字段）
      "current_interval_remaining_percent": 80.0,     // M3 新增：剩余百分比
      "remains_time": 3600000,                        // M3 改为：相对时间（毫秒）
      "start_time": 1699999999999,                    // M3 新增：窗口开始时间
      "end_time": 1699999999999,                      // M3 新增：窗口结束时间
      "current_weekly_total_count": 15000,            // 周限额总额
      "current_weekly_usage_count": 3000,             // 周剩余（兼容旧字段）
      "current_weekly_remaining_percent": 80.0,       // M3 新增：周剩余百分比
      "weekly_remains_time": 86400000                 // M3 新增：周重置倒计时（毫秒）
    }
  ]
}
```

#### 2. 订阅信息（可选）
```
GET https://www.minimaxi.com/v1/api/openplatform/charge/combo/cycle_audio_resource_package
?biz_line=2&cycle_type=1&resource_package_type=7
Authorization: Bearer <API_KEY>
```

**响应字段：**
```javascript
{
  "current_subscribe": {
    "current_subscribe_end_time": 1735689600000,    // 订阅到期时间
    "current_credit_reload_time": 1699999999999    // 额度重置时间
  }
}
```

#### 3. 账单记录（Token 消耗统计）
```
GET https://www.minimaxi.com/account/amount
?page=1&limit=100&aggregate=false
Authorization: Bearer <API_KEY>
```

**响应字段：**
```javascript
{
  "charge_records": [
    {
      "created_at": 1699999999,        // 时间戳（秒）
      "consume_token": 12345            // 消耗 Token 数
    }
  ]
}
```

### 用量计算逻辑（M3 更新）

```javascript
// M3: 使用 remaining_percent（剩余百分比）
intervalRemainingPercent = current_interval_remaining_percent  // 直接使用 API 返回值
intervalRemains = Math.round(total * remainingPercent / 100)   // 基于百分比计算
intervalUsed = total - intervalRemains

// M3: 颜色逻辑反转（剩得多绿，剩得少红）
if (remainingPercent >= 60) color = 'green'
else if (remainingPercent >= 30) color = 'orange'
else color = 'red'

// M3: 时间字段变为相对时间
intervalResetTime = Date.now() + remains_time  // remains_time 是毫秒数
weeklyResetTime = Date.now() + weekly_remains_time

// 周限额（同样使用 remaining_percent）
weeklyRemainingPercent = current_weekly_remaining_percent
weeklyRemains = Math.round(weeklyTotal * weeklyRemainingPercent / 100)
weeklyUsed = weeklyTotal - weeklyRemains

// Token 消耗统计（从账单记录聚合）
yesterdayTokens = sum(records where timestamp in [昨天0点, 今天0点))
sevenDayTokens = sum(records where timestamp >= 7天前)
monthTokens = sum(records where timestamp >= 本月1号0点)
```

---

## 🏗️ 技术架构

| 组件 | 技术 | 说明 |
|------|------|------|
| 扩展类型 | Manifest V3 | 最新 Chrome 扩展 API |
| 后台服务 | Service Worker | API 请求 + 定时刷新 |
| 数据存储 | Chrome Storage | local（API Key、历史）+ sync（设置） |
| 定时任务 | chrome.alarms | MV3 持久化定时器，最小 1 分钟间隔 |
| UI | 纯 HTML/CSS/JS | 动画环形进度条 + CSS 变量主题系统 |
| 网络请求 | fetch + AbortController | 15 秒超时控制 |

### 存储结构

```javascript
const STORAGE_KEYS = {
  API_KEY: 'minimax_api_key',           // local - 安全存储
  ENDPOINT: 'minimax_endpoint',         // sync - 端点选择
  AUTO_REFRESH_INTERVAL: 'minimax_auto_refresh_interval',  // sync
  AUTO_REFRESH_ENABLED: 'minimax_auto_refresh_enabled',    // sync
  HISTORY: 'minimax_usage_history',     // local - 30天过期
  LAST_USAGE: 'minimax_last_usage',     // local - 最新数据
  LOGS: 'minimax_logs'                  // local - 7天日志
};
```

---

## 📌 后续优化方向

- [ ] 发布到 Chrome Web Store
- [ ] 支持桌面通知（额度即将用尽时提醒）
- [ ] 快捷键支持
- [ ] 多账号管理
- [ ] 多模型用量明细显示
- [ ] 订阅到期提醒
