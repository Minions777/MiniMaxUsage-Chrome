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
  it('uses weekly palette when isWeekly=true', () => {
    expect(u.colorForPercentage(0.9, true).color).toBe('#4facfe');
    expect(u.colorForPercentage(0.9, true).gradient).toBe('url(#weeklyGradient)');
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
    });
  });

  it('handles empty records', () => {
    expect(u.calculateTokenStats([], now)).toEqual({
      yesterdayTokens: 0, sevenDayTokens: 0, monthTokens: 0,
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