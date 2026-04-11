# MiniMax Token Monitor (Chrome Extension)

🎨 一个精美的 Chrome 浏览器插件，实时监控 MiniMax Coding Plan Token 使用量，支持动画进度条和历史记录。

![Chrome Web Store](https://img.shields.io/badge/Chrome-v3.0-blue)
![Platform](https://img.shields.io/badge/platform-Chrome%20%2B%20Edge-green)

---

## ✨ 功能特性

- 📊 **实时监控** — Token 用量实时更新，带动画环形进度条
- 🎨 **精美 UI** — 深色渐变配色，与 macOS 版保持一致
- ⏱️ **自动刷新** — 可配置刷新间隔（10秒 ~ 10分钟）
- 🇨🇳 **双端点支持** — 同时支持中国区（minimaxi.com）和国际区（minimax.io）
- 🔐 **安全存储** — API Key 存储在本地 Chrome Storage，不上传任何服务器
- 🌈 **颜色提示** — 用量由低到高显示绿 → 橙 → 红
- 📈 **历史记录** — 记录每日用量，查看近 7 天柱状图和历史明细
- 🔔 **Badge 提醒** — 工具栏图标实时显示用量百分比

---

## 📋 环境要求

- Chrome 88+ 或 Edge 88+
- MiniMax API Key

---

## 🚀 安装方式

### 开发模式（加载已解压的扩展程序）

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角 **「开发者模式」**
3. 点击 **「加载已解压的扩展程序」**
4. 选择本项目文件夹
5. 点击插件图标 → ⚙️ 填入 API Key → 完成

---

## 🔑 API 说明

插件调用 MiniMax Coding Plan 查询接口：

```
GET https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains
Authorization: Bearer <你的_API_Key>
```

---

## 📁 项目结构

```
MiniMaxUsage-Chrome/
├── manifest.json          # 插件配置
├── background/
│   └── background.js      # Service Worker（API 请求 + 自动刷新）
├── popup/
│   ├── popup.html        # 弹出窗口界面
│   ├── popup.css         # 样式
│   └── popup.js          # 交互逻辑
├── icons/                # 插件图标
└── README.md
```

---

## 🏗️ 技术架构

- **Manifest V3** — 最新 Chrome 扩展 API
- **Service Worker** — 后台 API 请求 + 定时刷新
- **Chrome Storage** — 本地数据持久化（API Key / 历史记录）
- **Popup UI** — 纯 HTML/CSS/JS，动画环形进度条

---

## 📌 后续优化方向

- [ ] 发布到 Chrome Web Store
- [ ] 支持桌面通知（额度即将用尽时提醒）
- [ ] 快捷键支持
- [ ] 多账号管理

---

## 📄 开源协议

MIT
