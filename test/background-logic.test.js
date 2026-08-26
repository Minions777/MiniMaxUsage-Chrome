import { describe, it, expect, vi } from 'vitest';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ═══════════════════════════════════════════════════════════════════════════
// REAL integration tests for the background modules.
//
// The previous version of this file re-derived every decision formula inline
// (M3 reversal, billing TTL, retry predicate, badge color, dedup key, model
// selection) and asserted against the re-derivation — so deleting the matching
// production code left the suite green (a tautology giving false confidence).
//
// These tests load the ACTUAL background modules (utils + config + storage +
// billing + badge) into a shared vm context with a mocked `chrome` and call
// the real functions. Breaking or changing production behavior now fails
// these tests for real.
// ═══════════════════════════════════════════════════════════════════════════

function createChromeMock() {
  const store = { local: {}, sync: {} };
  const makeGet = (area) => vi.fn(async (keys) => {
    const arr = Array.isArray(keys) ? keys : [keys];
    const out = {};
    arr.forEach(k => { if (store[area][k] !== undefined) out[k] = store[area][k]; });
    return out;
  });
  const makeSet = (area) => vi.fn(async (items) => { Object.assign(store[area], items); });
  return {
    store,
    storage: {
      local: { get: makeGet('local'), set: makeSet('local') },
      sync: { get: makeGet('sync'), set: makeSet('sync') },
    },
    action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
    notifications: { create: vi.fn(async (id) => id) },
  };
}

// Load the real SW modules concatenated into ONE vm script so they share a
// single lexical scope (config's top-level `const`s are visible to
// storage/billing/badge, which is how importScripts works in the SW). utils.js
// (UMD, browser branch) attaches its functions to the context global, so the
// modules' bare references (dedupWindowKey, correctRemainingPct, …) resolve.
function loadBackgroundContext(chromeMock) {
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  const src = [
    read('lib/utils.js'),
    read('background/config.js'),
    read('background/storage.js'),
    read('background/billing.js'),
    read('background/badge.js'),
  ].join('\n;\n');
  const ctx = vm.createContext({ chrome: chromeMock, console });
  vm.runInContext(src, ctx);
  return ctx;
}

// ─── History dedup (real addHistoryRecord, not a re-derived || chain) ─────────

describe('addHistoryRecord dedup (real storage.js)', () => {
  async function setup() {
    const chrome = createChromeMock();
    const ctx = loadBackgroundContext(chrome);
    return { chrome, ctx };
  }

  it('records a new window once and skips a repeat in the same window', async () => {
    const { ctx } = await setup();
    const usage = { windowStartTime: 1700000000000, intervalUsed: 5, intervalRemains: 95, intervalTotal: 100 };
    await ctx.addHistoryRecord(usage);
    await ctx.addHistoryRecord(usage); // same window → dedup skip
    expect(await ctx.getHistory()).toHaveLength(1);
  });

  it('records again when the window changes', async () => {
    const { ctx } = await setup();
    await ctx.addHistoryRecord({ windowStartTime: 1700000000000, intervalUsed: 5, intervalRemains: 95, intervalTotal: 100 });
    await ctx.addHistoryRecord({ windowStartTime: 1700018000000, intervalUsed: 10, intervalRemains: 90, intervalTotal: 100 });
    expect(await ctx.getHistory()).toHaveLength(2);
  });

  it('persists the dedup key independently (LAST_WINDOW_KEY)', async () => {
    const { chrome, ctx } = await setup();
    await ctx.addHistoryRecord({ windowStartTime: 1700000000000, intervalUsed: 5, intervalRemains: 95, intervalTotal: 100 });
    expect(chrome.store.local).toHaveProperty('minimax_last_window_key', 1700000000000);
  });
});

// ─── Log retention cap (real saveLogs/addLog — the slice(-200) bug fix) ───────

describe('addLog retention (real storage.js — keeps NEWEST entries)', () => {
  it('keeps the newest LOG_MAX entries, dropping older ones (not the reverse)', async () => {
    const chrome = createChromeMock();
    const ctx = loadBackgroundContext(chrome);
    // LOG_MAX is 200 (config.js). Add more than the cap; addLog unshifts →
    // newest-first. The buggy slice(-200) kept the OLDEST; the fix keeps newest.
    for (let i = 0; i < 210; i++) {
      await ctx.addLog('info', `msg${i}`);
    }
    const logs = await ctx.getLogs();
    expect(logs).toHaveLength(200);
    // Newest entry (last added) must survive at the front.
    expect(logs[0].message).toBe('msg209');
  });

  it('serializes concurrent addLog calls (no lost-write)', async () => {
    const chrome = createChromeMock();
    const ctx = loadBackgroundContext(chrome);
    // Fire many logs without awaiting — the queue must serialize them.
    const calls = [];
    for (let i = 0; i < 50; i++) calls.push(ctx.addLog('info', `c${i}`));
    await Promise.all(calls);
    const logs = await ctx.getLogs();
    expect(logs).toHaveLength(50); // none lost
  });
});

// ─── Billing cache freshness (real loadCachedBilling, not re-derived TTL) ─────

describe('loadCachedBilling (real billing.js)', () => {
  it('returns records when fresh', async () => {
    const chrome = createChromeMock();
    chrome.store.local['minimax_billing_cache'] = { records: [{ id: 1 }], fetchedAt: Date.now() - 60000 };
    const ctx = loadBackgroundContext(chrome);
    expect(await ctx.loadCachedBilling()).toEqual([{ id: 1 }]);
  });

  it('returns [] when expired (>30 min TTL)', async () => {
    const chrome = createChromeMock();
    chrome.store.local['minimax_billing_cache'] = { records: [{ id: 1 }], fetchedAt: Date.now() - 31 * 60000 };
    const ctx = loadBackgroundContext(chrome);
    expect(await ctx.loadCachedBilling()).toEqual([]);
  });

  it('returns [] when records are empty (the ![] truthy-trap, now safe)', async () => {
    const chrome = createChromeMock();
    chrome.store.local['minimax_billing_cache'] = { records: [], fetchedAt: Date.now() };
    const ctx = loadBackgroundContext(chrome);
    expect(await ctx.loadCachedBilling()).toEqual([]);
  });

  it('returns [] when cache is missing', async () => {
    const ctx = loadBackgroundContext(createChromeMock());
    expect(await ctx.loadCachedBilling()).toEqual([]);
  });
});

// ─── Badge (real updateBadge — thresholds via shared COLOR_THRESHOLDS) ───────

describe('updateBadge (real badge.js)', () => {
  it('green badge for remaining >= 60', () => {
    const chrome = createChromeMock();
    const ctx = loadBackgroundContext(chrome);
    ctx.updateBadge({ intervalRemainingPercent: 80 });
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '80%' });
    expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#00d09c' });
  });

  it('yellow badge for remaining 30..59', () => {
    const chrome = createChromeMock();
    loadBackgroundContext(chrome).updateBadge({ intervalRemainingPercent: 45 });
    // toHaveBeenCalledWith sees all calls; assert the last color is yellow
    const colors = chrome.action.setBadgeBackgroundColor.mock.calls.map(c => c[0].color);
    expect(colors[colors.length - 1]).toBe('#fdcb6e');
  });

  it('red badge for remaining < 30', () => {
    const chrome = createChromeMock();
    loadBackgroundContext(chrome).updateBadge({ intervalRemainingPercent: 10 });
    const colors = chrome.action.setBadgeBackgroundColor.mock.calls.map(c => c[0].color);
    expect(colors[colors.length - 1]).toBe('#ff7675');
  });

  it('error badge (!) in red for usage with .error', () => {
    const chrome = createChromeMock();
    loadBackgroundContext(chrome).updateBadge({ error: 'NETWORK_ERROR' });
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '!' });
    expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#ff7675' });
  });
});

// ─── Low-usage notification (real maybeNotifyLowUsage — stable dedup key) ────

describe('maybeNotifyLowUsage (real badge.js — no repeat notifications)', () => {
  async function setup(overrides = {}) {
    const chrome = createChromeMock();
    chrome.store.sync = {
      minimax_notifications_enabled: true,
      minimax_notify_threshold: 10,
      minimax_notified_window_keys: [],
      ...overrides,
    };
    return { chrome, ctx: loadBackgroundContext(chrome) };
  }

  it('notifies once when below threshold', async () => {
    const { chrome, ctx } = await setup();
    await ctx.maybeNotifyLowUsage({ windowStartTime: 1700000000000, intervalRemainingPercent: 5 });
    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
  });

  it('does NOT repeat-notify for the SAME window (the drift-dedup-key bug)', async () => {
    const { chrome, ctx } = await setup();
    const usage = { windowStartTime: 1700000000000, intervalRemainingPercent: 5 };
    await ctx.maybeNotifyLowUsage(usage);
    await ctx.maybeNotifyLowUsage(usage);
    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
  });

  it('does not notify when above threshold', async () => {
    const { chrome, ctx } = await setup();
    await ctx.maybeNotifyLowUsage({ windowStartTime: 1700000000000, intervalRemainingPercent: 50 });
    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  it('does not notify when notifications are disabled', async () => {
    const { chrome, ctx } = await setup({ minimax_notifications_enabled: false });
    await ctx.maybeNotifyLowUsage({ windowStartTime: 1700000000000, intervalRemainingPercent: 1 });
    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });
});
