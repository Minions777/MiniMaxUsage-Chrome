import { describe, it, expect } from 'vitest';
const u = require('../lib/utils.js');

describe('formatNumber', () => {
  it('formats K and M magnitudes', () => {
    expect(u.formatNumber(0)).toBe('0');
    expect(u.formatNumber(999)).toBe('999');
    expect(u.formatNumber(1500)).toBe('1.5K');
    expect(u.formatNumber(1_500_000)).toBe('1.5M');
  });
  it('returns "--" for null / undefined / NaN', () => {
    expect(u.formatNumber(null)).toBe('--');
    expect(u.formatNumber(undefined)).toBe('--');
    expect(u.formatNumber(Number.NaN)).toBe('--');
  });
});

describe('formatTokensCN', () => {
  it('formats 万 / 亿 magnitudes', () => {
    expect(u.formatTokensCN(0)).toBe('0');
    expect(u.formatTokensCN(9999)).toBe('9999');
    expect(u.formatTokensCN(50000)).toBe('5.0万');
    expect(u.formatTokensCN(150_000_000)).toBe('1.5亿');
  });
});

describe('formatTime / formatTimeSeconds / formatDate', () => {
  const d = new Date(2026, 5, 16, 9, 5, 7);  // 2026-06-16 09:05:07 local
  it('formats HH:MM', () => expect(u.formatTime(d)).toBe('09:05'));
  it('formats HH:MM:SS', () => expect(u.formatTimeSeconds(d)).toBe('09:05:07'));
  it('formats MM/DD', () => expect(u.formatDate(d.getTime())).toBe('06/16'));
});

describe('colorForPercentage (M3: remainingPct is "remaining%", 0..1)', () => {
  it('returns red for low remaining', () => {
    expect(u.colorForPercentage(0.1).color).toBe('var(--red-color)');
    expect(u.colorForPercentage(0.1).gradient).toBe('url(#redGradient)');
  });
  it('returns orange for medium remaining', () => {
    expect(u.colorForPercentage(0.4).color).toBe('var(--orange-color)');
    expect(u.colorForPercentage(0.4).gradient).toBe('url(#orangeGradient)');
  });
  it('returns accent for high remaining', () => {
    expect(u.colorForPercentage(0.9).color).toBe('var(--accent)');
    expect(u.colorForPercentage(0.9).gradient).toBe('url(#greenGradient)');
  });
  it('threshold boundaries: 0.6 → green, 0.3 → orange, else red', () => {
    expect(u.colorForPercentage(0.6).gradient).toBe('url(#greenGradient)');
    expect(u.colorForPercentage(0.3).gradient).toBe('url(#orangeGradient)');
    expect(u.colorForPercentage(0.299).gradient).toBe('url(#redGradient)');
  });
});

describe('daysUntil', () => {
  it('returns positive integer for future date', () => {
    expect(u.daysUntil(new Date(Date.now() + 5 * 86400000))).toBe(5);
  });
  it('clamps past dates to 0', () => {
    expect(u.daysUntil(new Date(Date.now() - 5 * 86400000))).toBe(0);
  });
  it('returns null for invalid input', () => {
    expect(u.daysUntil(null)).toBe(null);
    expect(u.daysUntil(undefined)).toBe(null);
    expect(u.daysUntil(new Date('not a date'))).toBe(null);
  });
});

describe('formatResetCountdownMs', () => {
  it('returns "--" for zero or negative', () => {
    expect(u.formatResetCountdownMs(0)).toBe('--');
    expect(u.formatResetCountdownMs(-1000)).toBe('--');
  });
  it('formats minutes-only', () => {
    expect(u.formatResetCountdownMs(30 * 60000)).toBe('30 分钟后重置');
  });
  it('formats hours+minutes', () => {
    expect(u.formatResetCountdownMs(2 * 3600000 + 15 * 60000)).toBe('2 小时 15 分钟后重置');
  });
  it('formats hours-only when minutes is 0', () => {
    expect(u.formatResetCountdownMs(3 * 3600000)).toBe('3 小时后重置');
  });
});

describe('calculateTokenStats', () => {
  const now = new Date(2026, 5, 16, 12, 0, 0);  // 2026-06-16 noon local
  const nowMs = now.getTime();
  const todayStartMs = new Date(2026, 5, 16).getTime();           // local midnight today
  const yesterdayStartMs = todayStartMs - 86400000;
  const sevenDaysAgoMs = nowMs - 7 * 86400000;                     // matches utils internal calc
  const monthStartMs = new Date(2026, 5, 1).getTime();             // local midnight Jun 1

  it('aggregates into three windows', () => {
    const records = [
      // 2026-06-15 01:00 local → yesterday, within 7 days, this month
      { created_at: Math.floor((yesterdayStartMs + 3600000) / 1000), consume_token: 100 },
      // 7 days ago + 1 hour from `now` (not from todayStart) → matches utils boundary
      { created_at: Math.floor((sevenDaysAgoMs + 3600000) / 1000), consume_token: 200 },
      // 2026-06-15 23:58:20 local → yesterday, within 7 days, this month
      { created_at: Math.floor((todayStartMs - 100000) / 1000), consume_token: 999 },
      // 2026-05-31 23:58:20 local → not in any window
      { created_at: Math.floor((monthStartMs - 100000) / 1000), consume_token: 9999 },
    ];
    expect(u.calculateTokenStats(records, now)).toEqual({
      yesterdayTokens: 100 + 999,
      sevenDayTokens: 100 + 200 + 999,
      monthTokens: 100 + 200 + 999,
      periodTokens: 100 + 200 + 999 + 9999, // 近30天 = includes the "month-1" record too (within 30 days but before month start)
      totalTokens: 100 + 200 + 999 + 9999, // No aggregate endpoint → falls back to periodTokens
    });
  });

  it('handles empty records', () => {
    expect(u.calculateTokenStats([], now)).toEqual({
      yesterdayTokens: 0, sevenDayTokens: 0, monthTokens: 0,
      periodTokens: 0, totalTokens: 0,
    });
  });

  it('coerces consume_token strings via Number()', () => {
    const records = [{ created_at: Math.floor(todayStartMs / 1000) + 100, consume_token: '50' }];
    expect(u.calculateTokenStats(records, now).sevenDayTokens).toBe(50);
  });
});

describe('escapeHtml (no-DOM fallback)', () => {
  it('escapes special characters', () => {
    expect(u.escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
    );
  });
  it('handles null and undefined', () => {
    expect(u.escapeHtml(null)).toBe('');
    expect(u.escapeHtml(undefined)).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Tests for the extracted pure decision functions. These are the REAL
// production logic (the same functions background/core.js, badge.js,
// storage.js, billing.js call) — NOT inline re-derivations. Deleting or
// breaking the production logic now actually fails these tests.
// ═══════════════════════════════════════════════════════════════════════════

describe('resolveUsagePercents (M3 remaining% → used%/remaining% of base)', () => {
  it('converts raw remaining% to used% (no boost = 1.0×)', () => {
    // API 1 = 1% remaining → 99% used (matches official 5h: 已用 99%)
    expect(u.resolveUsagePercents(1, 1000, 0, 0)).toEqual({ usedPct: 99, remainingPct: 1 });
    // API 92 = 92% remaining → 8% used
    expect(u.resolveUsagePercents(92, 1000, 0, 0)).toEqual({ usedPct: 8, remainingPct: 92 });
  });
  it('applies the weekly boost factor (matches official 本周已用 45%)', () => {
    // raw remaining 70 of a 1.5× boosted total → used of base = (100-70)*1.5 = 45
    expect(u.resolveUsagePercents(70, 1500, 0, 0)).toEqual({ usedPct: 45, remainingPct: 55 });
    // raw 69 of 1.5× → (100-69)*1.5 = 46.5 → round 47
    expect(u.resolveUsagePercents(69, 1500, 0, 0)).toEqual({ usedPct: 47, remainingPct: 53 });
  });
  it('handles the 0/100 extremes', () => {
    // 0% remaining → 100% used
    expect(u.resolveUsagePercents(0, 1000, 0, 0)).toEqual({ usedPct: 100, remainingPct: 0 });
    // 100% remaining → 0% used (an inactive/unused model)
    expect(u.resolveUsagePercents(100, 1000, 0, 0)).toEqual({ usedPct: 0, remainingPct: 100 });
  });
  it('clamps out-of-range API values to [0,100]', () => {
    // -5 remaining → (100-(-5))*1 = 105 used → clamped 100
    expect(u.resolveUsagePercents(-5, 1000, 0, 0)).toEqual({ usedPct: 100, remainingPct: 0 });
    // 105 remaining → (100-105) = -5 used → clamped 0
    expect(u.resolveUsagePercents(105, 1000, 0, 0)).toEqual({ usedPct: 0, remainingPct: 100 });
    expect(u.resolveUsagePercents(150, 1000, 0, 0)).toEqual({ usedPct: 0, remainingPct: 100 });
  });
  it('falls back to count-based ratio when the API field is null/undefined', () => {
    // 300 used of 1500 → 20% used
    expect(u.resolveUsagePercents(null, 1000, 1500, 300)).toEqual({ usedPct: 20, remainingPct: 80 });
    // 750 used of 1000 → 75% used
    expect(u.resolveUsagePercents(undefined, 1000, 1000, 750)).toEqual({ usedPct: 75, remainingPct: 25 });
  });
  it('returns 0% used when the API field is absent and total is 0', () => {
    expect(u.resolveUsagePercents(null, 1000, 0, 0)).toEqual({ usedPct: 0, remainingPct: 100 });
    expect(u.resolveUsagePercents(undefined, 1000, 0, 5)).toEqual({ usedPct: 0, remainingPct: 100 });
  });
  it('usedPct + remainingPct always sum to 100 and are integers in [0,100]', () => {
    for (const v of [null, undefined, 0, 50, 100, -5, 105]) {
      const r = u.resolveUsagePercents(v, 1000, 500);
      expect(r).not.toBe(null);
      expect(Number.isInteger(r.usedPct)).toBe(true);
      expect(Number.isInteger(r.remainingPct)).toBe(true);
      expect(r.usedPct).toBeGreaterThanOrEqual(0);
      expect(r.usedPct).toBeLessThanOrEqual(100);
      expect(r.usedPct + r.remainingPct).toBe(100);
    }
  });
});

describe('selectMainModel (primary-model fallback chain)', () => {
  it('prefers MiniMax-M* models', () => {
    const models = [
      { model_name: 'video', current_interval_total_count: 0 },
      { model_name: 'general', current_interval_total_count: 500 },
      { model_name: 'MiniMax-M1', current_interval_total_count: 1000 },
    ];
    expect(u.selectMainModel(models).model_name).toBe('MiniMax-M1');
  });
  it('falls back to "general" when no MiniMax-M*', () => {
    const models = [
      { model_name: 'video', current_interval_total_count: 0 },
      { model_name: 'general', current_interval_total_count: 500 },
    ];
    expect(u.selectMainModel(models).model_name).toBe('general');
  });
  it('falls back to first model with quota > 0', () => {
    const models = [
      { model_name: 'video', current_interval_total_count: 0 },
      { model_name: 'unknown', current_interval_total_count: 500 },
    ];
    expect(u.selectMainModel(models).model_name).toBe('unknown');
  });
  it('falls back to first model when all have 0 quota', () => {
    expect(u.selectMainModel([{ model_name: 'video', current_interval_total_count: 0 }]).model_name).toBe('video');
  });
  it('returns undefined for empty/invalid input', () => {
    expect(u.selectMainModel([])).toBeUndefined();
    expect(u.selectMainModel(null)).toBeUndefined();
    expect(u.selectMainModel(undefined)).toBeUndefined();
  });
});

describe('dedupWindowKey (stable dedup key — no per-fetch drift)', () => {
  it('prefers windowStartTime (absolute, bit-stable)', () => {
    const usage = { windowStartTime: 1700000000000, intervalResetTime: 1700018000000 };
    expect(u.dedupWindowKey(usage)).toBe(1700000000000);
  });
  it('falls back to intervalResetTime when windowStartTime is null', () => {
    expect(u.dedupWindowKey({ windowStartTime: null, intervalResetTime: 1700018000000 })).toBe(1700018000000);
  });
  it('falls back to injectable now when both are null (deterministic in tests)', () => {
    expect(u.dedupWindowKey({ windowStartTime: null, intervalResetTime: null }, 12345)).toBe('12345');
  });
  it('is STABLE across two fetches in the same 5h window (the bug that repeat-notified)', () => {
    // intervalResetTime drifts per fetch (Date.now()+remains_ms), but windowStartTime is constant.
    const fetch1 = u.dedupWindowKey({ windowStartTime: 1700000000000, intervalResetTime: 1700017999000 });
    const fetch2 = u.dedupWindowKey({ windowStartTime: 1700000000000, intervalResetTime: 1700018001000 });
    expect(fetch1).toBe(fetch2); // same window → same dedup key → no repeat notification
  });
});

describe('isBillingCacheFresh / shouldIncludeBilling', () => {
  const TTL = 30 * 60 * 1000;
  it('isBillingCacheFresh: true when within TTL with records', () => {
    const cache = { records: [{ id: 1 }], fetchedAt: Date.now() - 29 * 60000 };
    expect(u.isBillingCacheFresh(cache, TTL)).toBe(true);
  });
  it('isBillingCacheFresh: false when past TTL', () => {
    const cache = { records: [{ id: 1 }], fetchedAt: Date.now() - 31 * 60000 };
    expect(u.isBillingCacheFresh(cache, TTL)).toBe(false);
  });
  it('isBillingCacheFresh: false when records empty (the empty-array truthy trap)', () => {
    expect(u.isBillingCacheFresh({ records: [], fetchedAt: Date.now() }, TTL)).toBe(false);
    expect(u.isBillingCacheFresh({ records: undefined }, TTL)).toBe(false);
    expect(u.isBillingCacheFresh(null, TTL)).toBe(false);
    expect(u.isBillingCacheFresh(undefined, TTL)).toBe(false);
  });
  it('shouldIncludeBilling is the inverse: true when expired/empty/missing', () => {
    expect(u.shouldIncludeBilling(null, TTL)).toBe(true);
    expect(u.shouldIncludeBilling({ records: [], fetchedAt: Date.now() }, TTL)).toBe(true);
    expect(u.shouldIncludeBilling({ records: [{ id: 1 }], fetchedAt: Date.now() - 35 * 60000 }, TTL)).toBe(true);
    expect(u.shouldIncludeBilling({ records: [{ id: 1 }], fetchedAt: Date.now() - 60000 }, TTL)).toBe(false);
  });
  it('uses the injectable now for deterministic boundary tests', () => {
    const fetched = 1000000;
    const cache = { records: [{ id: 1 }], fetchedAt: fetched };
    expect(u.isBillingCacheFresh(cache, TTL, fetched + TTL)).toBe(true);     // exactly at TTL → fresh (<=)
    expect(u.isBillingCacheFresh(cache, TTL, fetched + TTL + 1)).toBe(false); // just past → expired
  });
});

describe('shouldRetryStatus (retry policy)', () => {
  it('does NOT retry 4xx client errors (except 408/429)', () => {
    expect(u.shouldRetryStatus(400)).toBe(false);
    expect(u.shouldRetryStatus(401)).toBe(false);
    expect(u.shouldRetryStatus(403)).toBe(false);
    expect(u.shouldRetryStatus(404)).toBe(false);
  });
  it('retries 408 Request Timeout', () => expect(u.shouldRetryStatus(408)).toBe(true));
  it('retries 429 Too Many Requests', () => expect(u.shouldRetryStatus(429)).toBe(true));
  it('retries 5xx server errors', () => {
    expect(u.shouldRetryStatus(500)).toBe(true);
    expect(u.shouldRetryStatus(502)).toBe(true);
    expect(u.shouldRetryStatus(503)).toBe(true);
  });
});

describe('badgeColorHex (SW badge thresholds, shared with colorForPercentage)', () => {
  it('returns green for remaining >= 60', () => {
    expect(u.badgeColorHex(80)).toBe('#00d09c');
    expect(u.badgeColorHex(60)).toBe('#00d09c');
  });
  it('returns yellow for remaining 30..59', () => {
    expect(u.badgeColorHex(45)).toBe('#fdcb6e');
    expect(u.badgeColorHex(30)).toBe('#fdcb6e');
  });
  it('returns red for remaining < 30', () => {
    expect(u.badgeColorHex(20)).toBe('#ff7675');
    expect(u.badgeColorHex(0)).toBe('#ff7675');
  });
});

describe('pruneLogs (newest-first retention + cap)', () => {
  const now = 1_700_000_000_000;
  it('keeps only entries within retention window', () => {
    const logs = [
      { timestamp: now - 1000, msg: 'recent' },
      { timestamp: now - 8 * 86400000, msg: 'old' }, // 8 days ago → drop
    ];
    const pruned = u.pruneLogs(logs, now, 7, 200);
    expect(pruned).toHaveLength(1);
    expect(pruned[0].msg).toBe('recent');
  });
  it('keeps the NEWEST `max` entries (fixes the slice(-200) bug that dropped newest)', () => {
    const logs = [];
    for (let i = 0; i < 250; i++) logs.push({ timestamp: now - i, msg: `n${i}` }); // newest-first already
    const pruned = u.pruneLogs(logs, now, 7, 200);
    expect(pruned).toHaveLength(200);
    expect(pruned[0].msg).toBe('n0');   // newest kept
    expect(pruned[199].msg).toBe('n199');
  });
  it('handles empty / null input', () => {
    expect(u.pruneLogs([], now, 7, 200)).toEqual([]);
    expect(u.pruneLogs(null, now, 7, 200)).toEqual([]);
  });
});

describe('pruneHistoryRecords (retention + per-day cap, newest-first out)', () => {
  const now = 1_700_000_000_000;
  it('drops entries older than retention window', () => {
    const history = [
      { timestamp: now - 1000, used: 1, total: 10 },
      { timestamp: now - 31 * 86400000, used: 1, total: 10 }, // 31 days → drop
    ];
    const pruned = u.pruneHistoryRecords(history, now, 30, 24);
    expect(pruned).toHaveLength(1);
    expect(pruned[0].timestamp).toBe(now - 1000);
  });
  it('caps at maxPerDay per day, keeping the newest within each day', () => {
    const dayMs = new Date(now - 1000).toDateString();
    const history = [];
    for (let i = 0; i < 30; i++) history.push({ timestamp: now - 1000 - i * 1000, used: i, total: 100 });
    const pruned = u.pruneHistoryRecords(history, now, 30, 5);
    expect(pruned).toHaveLength(5); // capped to 5/day
    // newest-first: the 5 smallest offsets (most recent) kept
    expect(pruned[0].used).toBe(0); // most recent
  });
  it('output is newest-first overall', () => {
    const history = [
      { timestamp: now - 5000, used: 1, total: 10 },
      { timestamp: now - 1000, used: 2, total: 10 },
    ];
    const pruned = u.pruneHistoryRecords(history, now, 30, 24);
    expect(pruned[0].timestamp).toBe(now - 1000); // newest first
    expect(pruned[1].timestamp).toBe(now - 5000);
  });
});

describe('shared policy constants are exported', () => {
  it('COLOR_THRESHOLDS has GREEN_PCT 60 and ORANGE_PCT 30', () => {
    expect(u.COLOR_THRESHOLDS.GREEN_PCT).toBe(60);
    expect(u.COLOR_THRESHOLDS.ORANGE_PCT).toBe(30);
  });
  it('BILLING_WINDOW_DAYS is 30', () => {
    expect(u.BILLING_WINDOW_DAYS).toBe(30);
  });
});
