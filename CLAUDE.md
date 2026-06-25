# CLAUDE.md — MiniMax Token Monitor

## Project Overview

Chrome Extension (Manifest V3) that monitors MiniMax Coding Plan API token usage in real time. Displays quota via animated ring progress bars, tracks billing history, and supports 5 visual themes.

## Tech Stack

- **Runtime:** Chrome Extension MV3 (Service Worker + Popup)
- **Language:** Vanilla JavaScript (ES2020, no TypeScript, no framework)
- **Module system:** UMD in `lib/utils.js` (CJS for Node/vitest, browser globals for SW/popup); IIFE namespaces in popup (`PMM.theme`, `PMM.state`, `PMM.display`)
- **Testing:** Vitest (Node environment, `test/**/*.test.js`)
- **Storage:** `chrome.storage.local` (API key, history, logs, billing cache) + `chrome.storage.sync` (settings, theme)
- **No bundler** — files loaded via `<script>` tags (popup) and `importScripts()` (SW)

## Commands

```bash
npm test            # vitest run (all tests, single pass)
npm run test:watch  # vitest (watch mode)
```

No build step, no lint step, no formatter configured.

## Project Structure

```
background/          # Service Worker modules (loaded via importScripts in order)
  background.js      # Entry point: importScripts + MV3 event listeners + init
  config.js          # Constants: STORAGE_KEYS, ENDPOINTS, TTLs
  storage.js         # Chrome Storage CRUD helpers
  api.js             # fetch + retry + AbortController (15s timeout)
  billing.js         # Billing record cache with TTL
  badge.js           # Toolbar badge + desktop notifications
  alarms.js          # chrome.alarms auto-refresh scheduling
  core.js            # fetchUsage orchestrator
popup/               # Popup UI (loaded via <script> in popup.html)
  popup.html         # Shell
  popup.css          # CSS variable theme system
  themes.js          # 5 themes, exposed as PMM.theme
  state.js           # Shared state + DOM cache (PMM.state / PMM.dom)
  display.js         # Usage rendering + panel switching (PMM.display)
  main.js            # Init + event binding
  panels/            # settings.js, history.js, log.js
lib/utils.js         # Pure utility functions (UMD, shared by SW + popup + tests)
test/                # Vitest test files
```

## Architecture Rules

### Background modules
- `importScripts` order matters: `lib/utils.js` → `config.js` → `storage.js` → `api.js` → `billing.js` → `badge.js` → `alarms.js` → `core.js`
- All `chrome.*` event listeners MUST be at top-level scope (MV3 requirement — SW can be terminated anytime, only top-level registrations persist)
- Modules communicate via shared globals (no ESM imports in SW context)

### Popup modules
- Namespace pattern: each module attaches to `window.PMM.<namespace>` (e.g., `PMM.theme`, `PMM.state`, `PMM.display`)
- `lib/utils.js` merges into `PMM.util` and also exposes named globals on `window`
- Script load order in HTML matters — `state.js` before modules that read `PMM.state`

### Shared utilities (`lib/utils.js`)
- Pure functions only — no DOM, no `chrome.*`, no side effects
- UMD wrapper enables CJS (vitest), AMD, and browser global usage
- All new shared logic goes here; never duplicate across background/popup

## ⚠️ M3 API Semantic Inversion (Critical)

The MiniMax M3 API field `current_interval_remaining_percent` is **misleadingly named**:
- **Raw value 80 means 80% USED, not 80% remaining**
- Corrected: `remainingPercent = 100 - apiValue`
- Same inversion applies to `current_weekly_remaining_percent`

This reversal is applied in `background/core.js` before data reaches UI. When working with these fields, always check whether the value has been corrected. Look for `⚠️⚠️⚠️` comments in the codebase.

## Coding Conventions

- **Immutability:** create new objects, never mutate existing ones (especially storage data)
- **Error handling:** explicit at every layer; popup shows user-friendly messages; SW logs details
- **No hardcoded secrets:** API key stored in `chrome.storage.local`, never in source
- **Chinese UI text:** user-facing strings are in Chinese (this is intentional)
- **Formatting:** `formatNumber` for K/M, `formatTokensCN` for 万/亿, `formatDate` for MM/DD
- **Color thresholds:** remaining ≥60% → green, ≥30% → orange, <30% → red (see `colorForPercentage`)
- **Comments:** JSDoc for public functions; inline comments for non-obvious logic; `⚠️` markers for gotchas
- **File size:** keep files under ~400 lines; extract modules when approaching that limit

## Testing

- Tests live in `test/` and use vitest with `require()` (CJS)
- `lib/utils.js` functions are unit tested directly
- Background logic tests mock chrome APIs and test decision logic (dedup keys, cache expiry, retry, badge colors)
- Run `npm test` before any commit
- Current coverage: ~55 tests across `utils.test.js` and `background-logic.test.js`

## Common Pitfalls

1. **`![]` is `false` in JS** — empty array is truthy; use `.length === 0` for empty checks
2. **SW lifecycle** — Service Worker can terminate at any time; don't rely on in-memory state across alarms
3. **`chrome.alarms` minimum interval** — 1 minute minimum in MV3; don't set shorter
4. **`importScripts` timing** — must be at top-level, not inside async functions
5. **Popup script order** — `state.js` must load before modules that access `PMM.state`
6. **Billing cache TTL** — 30 minutes; auto-refresh alarm checks expiry and includes billing fetch when stale
