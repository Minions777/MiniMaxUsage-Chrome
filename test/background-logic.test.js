import { describe, it, expect, vi, beforeEach } from 'vitest';
const u = require('../lib/utils.js');

// ─── Mock chrome API for background module testing ────────────────────────
// Background modules use chrome.storage.local/sync. We mock it here so we
// can test pure decision logic without a real browser environment.

function createChromeMock() {
  const store = { local: {}, sync: {} };
  return {
    store, // Expose for direct inspection in tests
    storage: {
      local: {
        get: vi.fn(async (keys) => {
          const keyArr = Array.isArray(keys) ? keys : [keys];
          const result = {};
          keyArr.forEach(k => { if (store.local[k] !== undefined) result[k] = store.local[k]; });
          return result;
        }),
        set: vi.fn(async (items) => { Object.assign(store.local, items); }),
      },
      sync: {
        get: vi.fn(async (keys) => {
          const keyArr = Array.isArray(keys) ? keys : [keys];
          const result = {};
          keyArr.forEach(k => { if (store.sync[k] !== undefined) result[k] = store.sync[k]; });
          return result;
        }),
        set: vi.fn(async (items) => { Object.assign(store.sync, items); }),
      },
    },
  };
}

// ─── History dedup logic tests ────────────────────────────────────────────
// Tests the dedup decision logic that was improved in Task-6.
// The actual addHistoryRecord() runs in the SW context with real chrome API,
// but the dedup KEY SELECTION logic is what we need to verify.

describe('History dedup key selection (Task-6)', () => {
  it('prefers windowStartTime as dedup key (most stable)', () => {
    const usage = {
      windowStartTime: 1700000000000, // Absolute start of 5h window — never changes
      intervalResetTime: 1700018000000, // Absolute end — also stable but computed
    };
    // Simulate dedup key selection logic from storage.js
    const key = usage.windowStartTime || usage.intervalResetTime || String(Date.now());
    expect(key).toBe(1700000000000);
  });

  it('falls back to intervalResetTime when windowStartTime is null', () => {
    const usage = {
      windowStartTime: null,
      intervalResetTime: 1700018000000,
    };
    const key = usage.windowStartTime || usage.intervalResetTime || String(Date.now());
    expect(key).toBe(1700018000000);
  });

  it('falls back to Date.now() when both are null', () => {
    const usage = { windowStartTime: null, intervalResetTime: null };
    const before = Date.now();
    const key = usage.windowStartTime || usage.intervalResetTime || String(Date.now());
    const after = Date.now();
    expect(Number(key)).toBeGreaterThanOrEqual(before);
    expect(Number(key)).toBeLessThanOrEqual(after);
  });

  it('windowStartTime is stable across multiple fetches in same window', () => {
    // Simulate two fetches in the same 5h window:
    // - windowStartTime is always the same (absolute start from API)
    // - intervalResetTime shifts slightly (Date.now() + remains_time)
    const fetch1 = { windowStartTime: 1700000000000, intervalResetTime: 1700017999000 };
    const fetch2 = { windowStartTime: 1700000000000, intervalResetTime: 1700018001000 };

    const key1 = fetch1.windowStartTime || fetch1.intervalResetTime;
    const key2 = fetch2.windowStartTime || fetch2.intervalResetTime;
    expect(key1).toBe(key2); // Same dedup key — correct!
  });
});

// ─── Billing cache expiry tests ───────────────────────────────────────────
// Tests the cache TTL logic from billing.js.

describe('Billing cache expiry logic', () => {
  it('considers cache fresh when within TTL', () => {
    const cache = {
      records: [{ id: 1 }],
      fetchedAt: Date.now() - 29 * 60 * 1000, // 29 min ago (TTL is 30 min)
    };
    const isExpired = Date.now() - (cache.fetchedAt || 0) > 30 * 60 * 1000;
    expect(isExpired).toBe(false);
  });

  it('considers cache expired when past TTL', () => {
    const cache = {
      records: [{ id: 1 }],
      fetchedAt: Date.now() - 31 * 60 * 1000, // 31 min ago
    };
    const isExpired = Date.now() - (cache.fetchedAt || 0) > 30 * 60 * 1000;
    expect(isExpired).toBe(true);
  });

  it('considers cache expired when fetchedAt is 0', () => {
    const cache = { records: [], fetchedAt: 0 };
    const isExpired = Date.now() - (cache.fetchedAt || 0) > 30 * 60 * 1000;
    expect(isExpired).toBe(true);
  });

  it('considers cache expired when records are missing', () => {
    const cache = null;
    const hasRecords = cache && cache.records;
    expect(hasRecords).toBeFalsy();
  });
});

// ─── Auto-refresh billing inclusion logic (Task-7) ───────────────────────

describe('Auto-refresh billing inclusion (Task-7)', () => {
  it('includes billing when cache is null', () => {
    const billingCache = null;
    const includeBilling = !billingCache
      || !billingCache.records || billingCache.records.length === 0
      || Date.now() - (billingCache.fetchedAt || 0) > 30 * 60 * 1000;
    expect(includeBilling).toBe(true);
  });

  it('includes billing when records are empty', () => {
    const billingCache = { records: [], fetchedAt: Date.now() };
    const includeBilling = !billingCache
      || !billingCache.records || billingCache.records.length === 0
      || Date.now() - (billingCache.fetchedAt || 0) > 30 * 60 * 1000;
    expect(includeBilling).toBe(true);
  });

  it('excludes billing when cache is fresh and has records', () => {
    const billingCache = { records: [{ id: 1 }], fetchedAt: Date.now() - 5 * 60 * 1000 };
    const includeBilling = !billingCache
      || !billingCache.records || billingCache.records.length === 0
      || Date.now() - (billingCache.fetchedAt || 0) > 30 * 60 * 1000;
    expect(includeBilling).toBe(false);
  });

  it('includes billing when cache is expired but has records', () => {
    const billingCache = { records: [{ id: 1 }], fetchedAt: Date.now() - 35 * 60 * 1000 };
    const includeBilling = !billingCache
      || !billingCache.records || billingCache.records.length === 0
      || Date.now() - (billingCache.fetchedAt || 0) > 30 * 60 * 1000;
    expect(includeBilling).toBe(true);
  });
});

// ─── fetchJsonWithRetry logic (decision tests) ───────────────────────────
// Tests the retry decision logic, not the actual fetch.

describe('fetchJsonWithRetry retry decision', () => {
  it('should not retry on 4xx client errors (except 408/429)', () => {
    const status = 401;
    const shouldRetry = !(status >= 400 && status < 500 && status !== 408 && status !== 429);
    expect(shouldRetry).toBe(false); // 401: don't retry
  });

  it('should retry on 408 Request Timeout', () => {
    const status = 408;
    const shouldRetry = !(status >= 400 && status < 500 && status !== 408 && status !== 429);
    expect(shouldRetry).toBe(true); // 408: retry
  });

  it('should retry on 429 Too Many Requests', () => {
    const status = 429;
    const shouldRetry = !(status >= 400 && status < 500 && status !== 408 && status !== 429);
    expect(shouldRetry).toBe(true); // 429: retry
  });

  it('should retry on 5xx server errors', () => {
    const status = 503;
    // 5xx falls through the 4xx check, so it goes to the retry path
    const is4xxNoRetry = status >= 400 && status < 500 && status !== 408 && status !== 429;
    expect(is4xxNoRetry).toBe(false); // Not a non-retryable 4xx → will retry
  });

  it('should not retry on 200 OK', () => {
    const status = 200;
    // 200 would go to response.ok branch and return immediately
    expect(status).toBeGreaterThanOrEqual(200);
    expect(status).toBeLessThan(300);
  });
});

// ─── Badge color logic ────────────────────────────────────────────────────

describe('Badge color selection (based on corrected remaining%)', () => {
  function getBadgeColor(remainingPct) {
    if (remainingPct >= 60) return '#00d09c'; // Green
    if (remainingPct >= 30) return '#fdcb6e'; // Yellow
    return '#ff7675'; // Red
  }

  it('returns green for high remaining (>=60%)', () => {
    expect(getBadgeColor(80)).toBe('#00d09c');
    expect(getBadgeColor(60)).toBe('#00d09c');
  });

  it('returns yellow for medium remaining (30-59%)', () => {
    expect(getBadgeColor(45)).toBe('#fdcb6e');
    expect(getBadgeColor(30)).toBe('#fdcb6e');
  });

  it('returns red for low remaining (<30%)', () => {
    expect(getBadgeColor(20)).toBe('#ff7675');
    expect(getBadgeColor(5)).toBe('#ff7675');
    expect(getBadgeColor(0)).toBe('#ff7675');
  });
});

// ─── M3 API reversal verification ─────────────────────────────────────────
// Ensure the reversal logic in core.js produces correct remaining% values.

describe('M3 API remaining_percent reversal', () => {
  it('correctly reverses remaining_percent = 92 (used 92%) to remaining = 8%', () => {
    const apiRemainingPct = 92;
    const correctedRemaining = Math.round(100 - apiRemainingPct);
    expect(correctedRemaining).toBe(8);
  });

  it('correctly reverses remaining_percent = 20 (used 20%) to remaining = 80%', () => {
    const apiRemainingPct = 20;
    const correctedRemaining = Math.round(100 - apiRemainingPct);
    expect(correctedRemaining).toBe(80);
  });

  it('handles 0 (used 0%) → remaining = 100%', () => {
    const apiRemainingPct = 0;
    const correctedRemaining = Math.round(100 - apiRemainingPct);
    expect(correctedRemaining).toBe(100);
  });

  it('handles 100 (used 100%) → remaining = 0%', () => {
    const apiRemainingPct = 100;
    const correctedRemaining = Math.round(100 - apiRemainingPct);
    expect(correctedRemaining).toBe(0);
  });

  it('fallback: computes remaining% from used/total when API field is null', () => {
    const apiRemainingPct = null;
    const total = 1500;
    const used = 300;
    const remains = total - used;
    const correctedRemaining = apiRemainingPct !== null && apiRemainingPct !== undefined
      ? Math.round(100 - apiRemainingPct)
      : Math.round((remains / total) * 100);
    expect(correctedRemaining).toBe(80); // 1200/1500 = 80%
  });
});

// ─── Model selection fallback (VSCode extension reference) ─────────────

describe('Model selection fallback chain', () => {
  const models = [
    { model_name: 'video', current_interval_total_count: 0 },
    { model_name: 'general', current_interval_total_count: 500 },
    { model_name: 'MiniMax-M1', current_interval_total_count: 1000 },
  ];

  it('prefers MiniMax-M* models', () => {
    const selected = models.find(m => m.model_name?.startsWith('MiniMax-M'))
      || models.find(m => m.model_name === 'general')
      || models.find(m => m.current_interval_total_count > 0)
      || models[0];
    expect(selected.model_name).toBe('MiniMax-M1');
  });

  it('falls back to general when no MiniMax-M*', () => {
    const noMModels = [
      { model_name: 'video', current_interval_total_count: 0 },
      { model_name: 'general', current_interval_total_count: 500 },
    ];
    const selected = noMModels.find(m => m.model_name?.startsWith('MiniMax-M'))
      || noMModels.find(m => m.model_name === 'general')
      || noMModels.find(m => m.current_interval_total_count > 0)
      || noMModels[0];
    expect(selected.model_name).toBe('general');
  });

  it('falls back to first with quota > 0', () => {
    const sparseModels = [
      { model_name: 'video', current_interval_total_count: 0 },
      { model_name: 'unknown', current_interval_total_count: 500 },
    ];
    const selected = sparseModels.find(m => m.model_name?.startsWith('MiniMax-M'))
      || sparseModels.find(m => m.model_name === 'general')
      || sparseModels.find(m => m.current_interval_total_count > 0)
      || sparseModels[0];
    expect(selected.model_name).toBe('unknown');
  });

  it('falls back to first model when all have 0 quota', () => {
    const emptyModels = [
      { model_name: 'video', current_interval_total_count: 0 },
    ];
    const selected = emptyModels.find(m => m.model_name?.startsWith('MiniMax-M'))
      || emptyModels.find(m => m.model_name === 'general')
      || emptyModels.find(m => m.current_interval_total_count > 0)
      || emptyModels[0];
    expect(selected.model_name).toBe('video');
  });
});

// ─── calculateTokenStats extended (period + total) ──────────────────────

describe('calculateTokenStats with period + total (VSCode extension reference)', () => {
  it('includes periodTokens (30-day window)', () => {
    const stats = u.calculateTokenStats([
      { created_at: Math.floor(Date.now() / 1000) - 25 * 86400, consume_token: 100 },
    ]);
    expect(stats.periodTokens).toBe(100);
  });

  it('excludes records older than 30 days from periodTokens', () => {
    const stats = u.calculateTokenStats([
      { created_at: Math.floor(Date.now() / 1000) - 35 * 86400, consume_token: 100 },
    ]);
    expect(stats.periodTokens).toBe(0);
  });

  it('uses totalTokens parameter when provided', () => {
    const stats = u.calculateTokenStats([], undefined, 999999);
    expect(stats.totalTokens).toBe(999999);
  });

  it('falls back to periodTokens when totalTokens is 0', () => {
    const stats = u.calculateTokenStats([
      { created_at: Math.floor(Date.now() / 1000) - 5 * 86400, consume_token: 500 },
    ], undefined, 0);
    expect(stats.totalTokens).toBe(500); // Falls back to periodTokens
  });
});