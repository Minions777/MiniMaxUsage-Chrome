# MiniMaxUsage-Chrome Project Memory

## Project Overview
- Chrome MV3 extension for monitoring MiniMax API token usage
- Manifest V3, permissions: storage, alarms, notifications
- Dual endpoint: China (minimaxi.com) + International (minimax.io)

## Architecture (post refactor)
- background/ split into 7 modules: config, storage, api, billing, badge, alarms, core
- background.js is entry point only (importScripts + event listeners + init)
- popup uses PMM namespace: PMM.state, PMM.dom, PMM.display, PMM.theme, PMM.util
- lib/utils.js: UMD pure functions, shared across popup + background + tests

## Critical Notes
- M3 API `remaining_percent` field is SEMANTICALLY REVERSED: it means "used percent", not "remaining percent". Background core.js reverses: displayRemaining = 100 - api_remaining_percent. All downstream code receives corrected value.
- History dedup uses windowStartTime (stable absolute start) as primary key, not intervalResetTime (computed = Date.now() + ms)
- Billing cache: 30 min TTL, auto-refresh checks and refreshes when expired. Empty arrays `[]` are truthy in JS — must check `.length === 0`
- **NEVER use `\u{中文}` in JavaScript** — `\u{...}` requires hex code points only. Use direct Chinese characters/emoji literals instead. This caused 3 cascading Chrome runtime errors (fetchUsage undefined, Invalid Unicode escape, getTheme undefined)

## Testing
- 55 tests total: utils.test.js (22) + background-logic.test.js (33)
- vitest, CJS environment, Node
- Background logic tests are decision/logic tests (not full integration)

## Completed Optimizations (2026-06-17)
1. background.js 677-line monolith → 7 modular files
2. PMM.theme namespace (themes.js functions no longer on window global)
3. Tests: 8 → 55 (added background logic + M3 reversal + dedup + cache + badge + model fallback + period/total; removed weekly palette test)
4. M3 API reversal warning: ⚠️⚠️⚠️ level annotations in core.js/badge.js/utils.js
5. Removed empty popup/util.js
6. History dedup: windowStartTime key + LAST_WINDOW_KEY storage (decoupled from LAST_USAGE)
7. Billing cache: auto-refresh includes billing when expired; SW init proactively refreshes stale billing
8. Quota logic rewrite (VSCode extension reference):
   - fetchTotalTokens() aggregate endpoint (lifetime consumption)
   - fetchJsonWithRetry for main quota (not just billing)
   - general model fallback in model selection chain
   - calculateTokenStats returns periodTokens + totalTokens
   - Popup UI: added 近30天 and 累计 stat rows
9. Removed "本周剩余" feature: single 5h ring, no weekly ring/card, colorForPercentage no longer has isWeekly param