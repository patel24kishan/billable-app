import { describe, it, expect, vi } from 'vitest';
import { todayStr, currentMonthStr, monthRange, fmtDuration, hoursFromSeconds, fmtDateShort, monthLabel } from '../../src/domain/dates.js';

describe('todayStr / currentMonthStr', () => {
  it('use the local calendar date', () => {
    expect(todayStr(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(currentMonthStr(new Date(2026, 9, 10))).toBe('2026-10');
  });
  it('default to now', () => {
    const d = new Date();
    expect(todayStr()).toBe(todayStr(d));
    expect(currentMonthStr()).toBe(currentMonthStr(d));
  });
});

describe('monthRange', () => {
  it('returns the first and last day of the month', () => {
    expect(monthRange('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(monthRange('2028-02').end).toBe('2028-02-29');
    expect(monthRange('2026-12').end).toBe('2026-12-31');
  });
});

describe('fmtDuration', () => {
  it('formats seconds as HH:MM:SS', () => {
    expect(fmtDuration(0)).toBe('00:00:00');
    expect(fmtDuration(3661)).toBe('01:01:01');
    expect(fmtDuration(-5)).toBe('00:00:00');
    expect(fmtDuration(59.6)).toBe('00:01:00');
    expect(fmtDuration(360000)).toBe('100:00:00');
  });
});

describe('hoursFromSeconds', () => {
  it('rounds to hundredths of an hour', () => {
    expect(hoursFromSeconds(1000)).toBe(0.28);
    expect(hoursFromSeconds(3600)).toBe(1);
    expect(hoursFromSeconds(0)).toBe(0);
    expect(hoursFromSeconds(5)).toBe(0);
  });
});

describe('fmtDateShort / monthLabel (en-US pinned, step 12 / B7)', () => {
  it('format the local calendar date as en-US regardless of the host locale or TZ', () => {
    expect(fmtDateShort('2026-10-09')).toBe('Oct 9, 2026');
    expect(fmtDateShort('2026-01-01')).toBe('Jan 1, 2026');
    expect(fmtDateShort('2026-12-31')).toBe('Dec 31, 2026');
    expect(monthLabel('2026-10')).toBe('October 2026');
    expect(monthLabel('2027-01')).toBe('January 2027');
  });
  it('asks Intl for the en-US locale explicitly (not the host default)', () => {
    const spy = vi.spyOn(Date.prototype, 'toLocaleDateString');
    fmtDateShort('2026-10-09'); monthLabel('2026-10');
    expect(spy.mock.calls.map((c) => c[0])).toEqual(['en-US', 'en-US']);
    spy.mockRestore();
  });
});
