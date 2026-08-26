import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ═══════════════════════════════════════════════════════════════════════════
// Integration tests for api.js + core.js — the network/orchestration layer that
// the storage/billing/badge harness in background-logic.test.js does NOT load.
// Covers: fetchJsonWithRetry retry policy, fetchAllBillingRecords pagination,
// subscription/totalTokens TTL caching, and the fetchUsage in-flight mutex.
// All driven against the REAL module source (vm harness + mocked fetch + fake
// timers for the exponential-backoff sleeps).
// ═══════════════════════════════════════════════════════════════════════════

function createChromeMock(initial = {}) {
  const store = { local: { ...initial.local }, sync: { ...initial.sync } };
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
    alarms: { clear: vi.fn(async () => {}), create: vi.fn() },
  };
}

function readSrc(files) {
  return files
    .map(f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8'))
    .join('\n;\n');
}

// Load utils + config + storage + api into a shared vm scope (api.js needs
// addLog from storage + shouldRetryStatus + config consts + BILLING_WINDOW_DAYS
// from utils). Injects fetch / AbortController / setTimeout for the retry loop.
function loadApiContext(chromeMock, fetchStub) {
  const src = readSrc(['lib/utils.js', 'background/config.js', 'background/storage.js', 'background/api.js']);
  const ctx = vm.createContext({
    chrome: chromeMock,
    fetch: fetchStub,
    AbortController,
    setTimeout,
    clearTimeout,
    console,
  });
  vm.runInContext(src, ctx);
  return ctx;
}

// Load the full SW module set (through core.js — NOT background.js, which has
// top-level listener registration + an init IIFE that must not auto-run here).
function loadFullContext(chromeMock, fetchStub) {
  const src = readSrc([
    'lib/utils.js', 'background/config.js', 'background/storage.js', 'background/api.js',
    'background/billing.js', 'background/badge.js', 'background/alarms.js', 'background/core.js',
  ]);
  const ctx = vm.createContext({
    chrome: chromeMock,
    fetch: fetchStub,
    AbortController,
    setTimeout,
    clearTimeout,
    console,
  });
  vm.runInContext(src, ctx);
  return ctx;
}

function ok(body) { return { ok: true, status: 200, json: async () => body }; }
function httpError(status) { return { ok: false, status, json: async () => ({}) }; }

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// ─── fetchJsonWithRetry (real api.js) ─────────────────────────────────────────

describe('fetchJsonWithRetry (real api.js)', () => {
  it('returns json on 200 without retry', async () => {
    const fetchStub = vi.fn(async () => ok({ ok: true }));
    const ctx = loadApiContext(createChromeMock(), fetchStub);
    const r = await ctx.fetchJsonWithRetry('http://x', {});
    expect(r).toEqual({ ok: true });
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('retries 5xx up to maxAttempts then throws the last error', async () => {
    const fetchStub = vi.fn(async () => httpError(500));
    const ctx = loadApiContext(createChromeMock(), fetchStub);
    const p = ctx.fetchJsonWithRetry('http://x', {}, { maxAttempts: 3, backoffMs: 500 });
    // Pre-attach the rejection handler so the rejection fired during timer
    // advance isn't momentarily unhandled.
    const caught = p.catch(e => e);
    await vi.advanceTimersByTimeAsync(5000); // drive 500 + 1000 backoffs
    expect((await caught).message).toBe('HTTP 500');
    expect(fetchStub).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry 401 (immediate client-error abort)', async () => {
    const fetchStub = vi.fn(async () => httpError(401));
    const ctx = loadApiContext(createChromeMock(), fetchStub);
    const p = ctx.fetchJsonWithRetry('http://x', {});
    const caught = p.catch(e => e);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await caught).message).toBe('HTTP 401');
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('retries 429 (Too Many Requests)', async () => {
    const fetchStub = vi.fn(async () => httpError(429));
    const ctx = loadApiContext(createChromeMock(), fetchStub);
    const p = ctx.fetchJsonWithRetry('http://x', {}, { maxAttempts: 2, backoffMs: 500 });
    const caught = p.catch(e => e);
    await vi.advanceTimersByTimeAsync(2000);
    expect((await caught).message).toBe('HTTP 429');
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it('recovers after a transient 500 then 200', async () => {
    const fetchStub = vi.fn()
      .mockResolvedValueOnce(httpError(500))
      .mockResolvedValueOnce(ok({ ok: true }));
    const ctx = loadApiContext(createChromeMock(), fetchStub);
    const p = ctx.fetchJsonWithRetry('http://x', {}, { maxAttempts: 3, backoffMs: 500 });
    await vi.advanceTimersByTimeAsync(2000);
    const r = await p;
    expect(r).toEqual({ ok: true });
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });
});

// ─── fetchAllBillingRecords pagination (real api.js) ──────────────────────────

describe('fetchAllBillingRecords pagination (real api.js)', () => {
  function recentRecords(count, offsetSeconds = 0) {
    const out = [];
    for (let i = 0; i < count; i++) {
      out.push({ created_at: Math.floor((Date.now() - (offsetSeconds + i) * 1000) / 1000), consume_token: 10 });
    }
    return out;
  }

  it('stops on a short (last) page', async () => {
    const fetchStub = vi.fn()
      .mockResolvedValueOnce(ok({ charge_records: recentRecords(100) }))
      .mockResolvedValueOnce(ok({ charge_records: recentRecords(50) }));
    const ctx = loadApiContext(createChromeMock(), fetchStub);
    const recs = await ctx.fetchAllBillingRecords('key', { baseURL: 'http://x', billingPath: '/b' });
    expect(recs).toHaveLength(150);
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it('stops on an empty page', async () => {
    const fetchStub = vi.fn()
      .mockResolvedValueOnce(ok({ charge_records: recentRecords(100) }))
      .mockResolvedValueOnce(ok({ charge_records: [] }));
    const ctx = loadApiContext(createChromeMock(), fetchStub);
    const recs = await ctx.fetchAllBillingRecords('key', { baseURL: 'http://x', billingPath: '/b' });
    expect(recs).toHaveLength(100);
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it('skips out-of-window records and stops paging (newest-first)', async () => {
    const recentTs = Math.floor(Date.now() / 1000);
    const oldTs = Math.floor((Date.now() - 31 * 86400000) / 1000);
    const fetchStub = vi.fn().mockResolvedValueOnce(ok({
      charge_records: [
        { created_at: recentTs, consume_token: 5 },
        { created_at: oldTs, consume_token: 999 }, // old → skipped, stops paging
      ],
    }));
    const ctx = loadApiContext(createChromeMock(), fetchStub);
    const recs = await ctx.fetchAllBillingRecords('key', { baseURL: 'http://x', billingPath: '/b' });
    expect(recs).toHaveLength(1); // only the recent record kept
    expect(fetchStub).toHaveBeenCalledTimes(1); // stopped after page 1
  });
});

// ─── TTL caching (real api.js) ────────────────────────────────────────────────

describe('fetchSubscription / fetchTotalTokens TTL caching (real api.js)', () => {
  it('caches a successful subscription and skips the network within TTL', async () => {
    const fetchStub = vi.fn(async () => ok({ current_subscribe: { end: 123 } }));
    const chrome = createChromeMock();
    const ctx = loadApiContext(chrome, fetchStub);
    const r1 = await ctx.fetchSubscription('key', { baseURL: 'http://x', subscriptionPath: '/s' });
    const r2 = await ctx.fetchSubscription('key', { baseURL: 'http://x', subscriptionPath: '/s' });
    expect(r1).toEqual({ end: 123 });
    expect(r2).toEqual({ end: 123 });
    expect(fetchStub).toHaveBeenCalledTimes(1); // 2nd served from cache
    expect(chrome.store.local['minimax_subscription_cache'].value).toEqual({ end: 123 });
  });

  it('does NOT cache a subscription failure (next call retries the network)', async () => {
    const fetchStub = vi.fn(async () => httpError(500));
    const chrome = createChromeMock();
    const ctx = loadApiContext(chrome, fetchStub);
    const p = ctx.fetchSubscription('key', { baseURL: 'http://x', subscriptionPath: '/s' });
    await vi.advanceTimersByTimeAsync(20000); // drive the 3 retry backoffs
    const r = await p;
    expect(r).toBeNull();
    expect(chrome.store.local['minimax_subscription_cache']).toBeUndefined(); // not cached
    expect(fetchStub).toHaveBeenCalledTimes(3);
  });

  it('caches totalTokens and skips the network within TTL', async () => {
    const fetchStub = vi.fn(async () => ok({ consume_token_sum: 99999 }));
    const chrome = createChromeMock();
    const ctx = loadApiContext(chrome, fetchStub);
    const r1 = await ctx.fetchTotalTokens('key', { baseURL: 'http://x', billingPath: '/b' });
    const r2 = await ctx.fetchTotalTokens('key', { baseURL: 'http://x', billingPath: '/b' });
    expect(r1).toBe(99999);
    expect(r2).toBe(99999);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(chrome.store.local['minimax_total_tokens_cache'].value).toBe(99999);
  });
});

// ─── fetchUsage in-flight mutex (real core.js) ─────────────────────────────────

describe('fetchUsage in-flight mutex (real core.js)', () => {
  function makeRemainsBody(remainingPct = 80, weeklyBoostPermille) {
    return {
      base_resp: { status_code: 0 },
      model_remains: [{
        model_name: 'MiniMax-M1',
        current_interval_total_count: 1000,
        current_interval_usage_count: 200,
        current_interval_remaining_percent: remainingPct, // remaining % (of boosted)
        remains_time: 3600000,
        start_time: 1700000000000,
        end_time: 1700018000000,
        current_weekly_total_count: 5000,
        current_weekly_usage_count: 1000,
        current_weekly_remaining_percent: remainingPct,
        weekly_remains_time: 7200000,
        weekly_boost_permille: weeklyBoostPermille,
      }],
    };
  }

  // Wire a fetch stub that answers each endpoint by URL.
  function setupFetch(stub) {
    return vi.fn(async (url) => {
      if (url.includes('/remains')) return ok(makeRemainsBody());
      if (url.includes('cycle_audio_resource_package')) {
        return ok({ current_subscribe: {
          current_subscribe_end_time: Date.now() + 86400000,
          current_credit_reload_time: 0,
        } });
      }
      if (url.includes('aggregate=true')) return ok({ consume_token_sum: 99999 });
      if (url.includes('/account/amount')) return ok({ charge_records: [] }); // empty → stop
      return ok({});
    });
  }

  it('dedupes concurrent NON-force calls to a single remains fetch', async () => {
    const chrome = createChromeMock({ local: { minimax_api_key: 'test-key' } });
    const fetchStub = setupFetch();
    const ctx = loadFullContext(chrome, fetchStub);
    // No LAST_FETCH_AT cached → both pass the throttle (first call always fetches).
    const p1 = ctx.fetchUsage({});
    const p2 = ctx.fetchUsage({}); // concurrent, same cycle
    await vi.advanceTimersByTimeAsync(20000);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.intervalRemainingPercent).toBe(80); // 80% remaining → 20% used
    expect(r1.intervalUsedPercent).toBe(20);
    expect(r2.intervalRemainingPercent).toBe(80);
    const remainsCalls = fetchStub.mock.calls.filter(c => c[0].includes('/remains')).length;
    expect(remainsCalls).toBe(1); // mutex deduped the second concurrent call
  });

  it('a force call runs its own fetch (does not share an in-flight non-force)', async () => {
    const chrome = createChromeMock({ local: { minimax_api_key: 'test-key' } });
    const fetchStub = setupFetch();
    const ctx = loadFullContext(chrome, fetchStub);
    const p1 = ctx.fetchUsage({});            // non-force, starts first
    const p2 = ctx.fetchUsage({ force: true }); // force → skips dedup, own fetch
    await vi.advanceTimersByTimeAsync(20000);
    const [, r2] = await Promise.all([p1, p2]);
    expect(r2.intervalRemainingPercent).toBe(80); // 80% remaining → 20% used
    const remainsCalls = fetchStub.mock.calls.filter(c => c[0].includes('/remains')).length;
    expect(remainsCalls).toBe(2); // force bypassed the in-flight non-force
  });

  it('resolves raw remaining% → used%/remaining% end-to-end (remaining 92 → 8% used)', async () => {
    const fetchStub = vi.fn(async (url) => {
      if (url.includes('/remains')) return ok(makeRemainsBody(92));
      if (url.includes('cycle_audio_resource_package')) return ok({ current_subscribe: null });
      if (url.includes('aggregate=true')) return ok({ consume_token_sum: 0 });
      if (url.includes('/account/amount')) return ok({ charge_records: [] });
      return ok({});
    });
    const chrome = createChromeMock({ local: { minimax_api_key: 'test-key' } });
    const ctx = loadFullContext(chrome, fetchStub);
    const p = ctx.fetchUsage({ force: true });
    await vi.advanceTimersByTimeAsync(20000);
    const r = await p;
    // 92% remaining (no boost) → 8% used
    expect(r.intervalRemainingPercent).toBe(92);
    expect(r.intervalUsedPercent).toBe(8);
    expect(r.weeklyRemainingPercent).toBe(92);
    expect(r.weeklyUsedPercent).toBe(8);
    expect(chrome.store.local['minimax_last_usage'].intervalUsedPercent).toBe(8);
  });

  it('applies the weekly boost factor to match the official site (remaining 70, 1.5× → 45% used)', async () => {
    const fetchStub = vi.fn(async (url) => {
      if (url.includes('/remains')) return ok(makeRemainsBody(70, 1500));
      if (url.includes('cycle_audio_resource_package')) return ok({ current_subscribe: null });
      if (url.includes('aggregate=true')) return ok({ consume_token_sum: 0 });
      if (url.includes('/account/amount')) return ok({ charge_records: [] });
      return ok({});
    });
    const chrome = createChromeMock({ local: { minimax_api_key: 'test-key' } });
    const ctx = loadFullContext(chrome, fetchStub);
    const p = ctx.fetchUsage({ force: true });
    await vi.advanceTimersByTimeAsync(20000);
    const r = await p;
    // weekly: (100-70) × 1.5 = 45% used of base — matches the official site
    expect(r.weeklyUsedPercent).toBe(45);
    expect(r.weeklyRemainingPercent).toBe(55);
    // interval has no boost: (100-70) × 1.0 = 30% used
    expect(r.intervalUsedPercent).toBe(30);
  });
});
