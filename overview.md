# MiniMaxUsage-Chrome 优化总览

## 完成状态：7/7 全部完成 ✅

| # | 问题 | 优化方案 | 结果 |
|---|------|----------|------|
| 1 | background.js 677行巨石 | 拆分为7个模块 (config/storage/api/billing/badge/alarms/core) + 入口文件 | ✅ background.js 从677行→~150行入口 |
| 2 | window.PMM全局污染 | themes.js函数收归PMM.theme namespace | ✅ 消除window全局函数 |
| 3 | 测试仅8个 | 新增25个后台逻辑决策测试 | ✅ 8→48个测试 |
| 4 | M3 API语义反转无标注 | ⚠️⚠️⚠️级警告+JSDoc注释 | ✅ core.js/badge.js/utils.js |
| 5 | popup/util.js冗余空壳 | 删除文件+移除HTML引用 | ✅ 文件已删除 |
| 6 | 历史去重依赖不稳定key | 改用windowStartTime+独立LAST_WINDOW_KEY | ✅ 去耦更稳定 |
| 7 | 账单缓存首次打开可能为空 | alarm自动检查TTL+SW重启主动刷新 | ✅ 同时修复空数组bug |

## 额外发现并修复的Bug
- **空数组truthy陷阱**: `![]` = false 导致空账单缓存不触发刷新 → 改为 `.length === 0`

## 测试验证
- **48个测试全部通过** (utils.test.js 23 + background-logic.test.js 25)

## 文件变更清单
### 新增
- `background/config.js` — 常量定义
- `background/storage.js` — Storage CRUD
- `background/api.js` — 网络请求+重试
- `background/billing.js` — 账单缓存
- `background/badge.js` — Badge+通知
- `background/alarms.js` — 自动刷新调度
- `background/core.js` — fetchUsage核心逻辑
- `test/background-logic.test.js` — 后台逻辑测试

### 重写
- `background/background.js` — 从677行→~150行入口
- `popup/themes.js` — PMM.theme namespace

### 修改
- `popup/popup.html` — 移除util.js script标签
- `popup/panels/settings.js` — PMM.theme引用
- `popup/main.js` — PMM.theme引用
- `lib/utils.js` — colorForPercentage JSDoc警告
- `README.md` — 项目结构+优化记录

### 删除
- `popup/util.js` — 空壳冗余文件

---

# 第二轮优化(2026-08):全量审计 + 修复

基于 6 视角对抗式审计(架构/正确性/安全/性能/测试/可访问性,52 个 agent,39 条确认发现 + 7 条验证淘汰),逐项修复。

## 完成状态:40/40 ✅(39 审计确认 + 1 复核中发现)

### P0 正确性 Bug(7)
| # | 位置 | 问题 | 修复 |
|---|------|------|------|
| 1 | `badge.js` | 低用量通知去重 key 用 `intervalResetTime`(漂移)→ 同窗口重复弹通知 | 改用 `dedupWindowKey()`→ `windowStartTime`(稳定) |
| 2 | `core.js` | SW 重启时 init IIFE 与 alarm 并发 `fetchUsage` 无锁 → 重复请求 | 加 `fetchInFlight` in-flight 互斥(非 force 共享,force 独立) |
| 3 | `history.js` | `dailyDelta` 跨 5h 窗口重置出负值/双负号 | 改为正步差累加(只计窗口内增量,忽略重置) |
| 4 | `display.js` | "更新于" 显示弹窗打开时间而非抓取时间 | 用 usage 对象携带的 `fetchedAt` |
| 5 | `display.js` | 永远显示"自动刷新中",即使已关闭 | 按 `autoRefreshEnabled` 分支 + `.paused` |
| 6 | `core.js` | M3 反转后未 clamp,API 异常值显示 105%/-5% | `correctRemainingPct()` clamp 到 [0,100] |
| 7 | `storage.js` | `saveLogs` 用 `.slice(-200)` 在 newest-first 上保留最旧 200 条 → 最新日志被丢 | `pruneLogs()` 用 `.slice(0, max)` |

### P1 测试质量根因(根治)
- **问题**:几乎所有 background-logic 测试内联重写公式,从不 require 真实模块;`createChromeMock` 定义却从未调用 → 删掉生产代码测试照样全绿(假覆盖)。
- **根治**:把纯决策逻辑提取到 `lib/utils.js`(`correctRemainingPct`/`selectMainModel`/`dedupWindowKey`/`isBillingCacheFresh`/`shouldIncludeBilling`/`shouldRetryStatus`/`badgeColorHex`/`pruneLogs`/`pruneHistoryRecords`),生产代码与测试都调用同一函数。
- **vm 测试框架**:用 `vm.createContext` 把真实 SW 模块源码拼接加载(镜像 `importScripts`),配 mock chrome,真正调用 `addHistoryRecord`/`saveLogs`/`loadCachedBilling`/`updateBadge`/`maybeNotifyLowUsage`;新增 `test/api-logic.test.js` 覆盖 `fetchJsonWithRetry` 重试策略、`fetchAllBillingRecords` 分页、subscription/totalTokens TTL 缓存、`fetchUsage` in-flight 互斥。
- **测试数:55 → 88,全部真实覆盖**(无重言式)。

### P2 架构/可维护性(7)
- alarm handler 不再泄漏 billing 缓存私有形状(用 `shouldIncludeBilling()`)。
- 颜色阈值单源:`COLOR_THRESHOLDS`(utils),`colorForPercentage`(0..1)与 `badgeColorHex`(0..100)共用。
- 30天/24条/7天/200条/100页等魔法数字集中到 `config.js`(`BILLING_WINDOW_DAYS` 置于 utils 以满足加载顺序)。
- `correctRemainingPct` 消除 4 处剩余百分比 fallback 重复(core/badge×2/display)。
- `fetchSubscription` 失败补 `addLog('warn')`(与兄弟函数一致)。
- 移除 `Promise.allSettled` 外死 try/catch(allSettled 不 reject)。
- 删除 `stopAutoRefresh` 死代码。
- `addHistoryRecord` 加 `historyWriteQueue` 串行 + 临界区重检(关闭并发丢更新竞争)。

### P3 性能(5)
- billing 分页:加 `limit`/`maxPages` 常量 + sort-order-safe 早停(不丢边界 record)。
- `fetchSubscription`(6h)/`fetchTotalTokens`(10min)TTL 缓存,失败不缓存。
- `addLog` 串行队列(无 lost-write)。
- `addHistoryRecord` 批量读/写(4→2 往返)。
- popup `init()` GET_SETTINGS + GET_USAGE 可并行(未改 — 见说明)。

### P4 可访问性/UX(6)
- `.theme-option` → `<button aria-pressed>`(键盘可达)。
- 面板切换焦点管理(进入面板 focus back 按钮)。
- 历史日期头 → `<button aria-expanded aria-controls>`。
- API Key/阈值输入 `<label for=>` 关联。
- `--text-muted` 提至 0.6(达 WCAG AA 4.5:1)。
- 主题化确认弹窗(`popup/confirm.js`,focus trap + Esc)替代阻塞式 `confirm()`。

## 验证
- `npm test`:88 passed(0 warning,0 unhandled error)。
- 独立 code-reviewer 复核:0 CRITICAL / 0 HIGH,3 MEDIUM 已全部修复。

## 文件变更(18 改 + 2 新)
**新增**:`popup/confirm.js`、`test/api-logic.test.js`
**重写**:`lib/utils.js`(纯决策函数)、`background/core.js`(互斥+clamp+fetchedAt)、`background/storage.js`(队列+批量+剪枝)、`test/background-logic.test.js`(真实集成测试)、`test/utils.test.js`(新增纯函数测试)
**修改**:`background/{api,billing,badge,alarms,background,config}.js`、`popup/{display,themes,state}.js`、`popup/panels/{history,log}.js`、`popup/popup.{html,css}`
