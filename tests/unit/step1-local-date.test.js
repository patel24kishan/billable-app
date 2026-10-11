// Step 1 (C1): dates are LOCAL calendar dates, never the UTC slice.
// Expected values come from local Date getters so the file is timezone-robust;
// run it under TZ=America/Los_Angeles and TZ=Asia/Tokyo to exercise the cases
// where the UTC date differs from the local date.
import { describe, it, expect } from 'vitest';
import { localDateStr, todayStr } from '../../src/domain/dates.js';
import { startTimer, entryFromStoppedTimer } from '../../src/domain/timer.js';

const pad = (n) => String(n).padStart(2, '0');
const expectedLocal = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

const lateEvening = new Date(2026, 9, 10, 23, 30); // local 23:30 (UTC is the next day west of UTC)
const justAfterMidnight = new Date(2026, 9, 11, 0, 30); // local 00:30 (UTC is the previous day east of UTC)

describe('localDateStr', () => {
  it('formats a Date as its local calendar date', () => {
    expect(localDateStr(new Date(2026, 0, 5, 12))).toBe('2026-01-05');
    expect(localDateStr(lateEvening)).toBe('2026-10-10');
    expect(localDateStr(justAfterMidnight)).toBe('2026-10-11');
  });
  it('accepts an ISO string and uses the local date of that instant', () => {
    expect(localDateStr(lateEvening.toISOString())).toBe('2026-10-10');
    expect(localDateStr(justAfterMidnight.toISOString())).toBe('2026-10-11');
    expect(localDateStr(lateEvening.toISOString())).toBe(expectedLocal(lateEvening));
  });
  it('todayStr reuses it and keeps its signature', () => {
    expect(todayStr(lateEvening)).toBe(localDateStr(lateEvening));
    expect(todayStr()).toBe(localDateStr(new Date()));
    expect(todayStr.length).toBe(0);
  });
});

describe('entryFromStoppedTimer date (C1)', () => {
  const stopped = (startedAt) => ({
    ...startTimer({ clientId: 'c1', clientName: 'Acme', description: 'Design' }, startedAt),
    status: 'stopped', accumulatedSeconds: 600, segmentStartedAt: null
  });
  const nowIso = new Date(2026, 9, 12, 9, 0).toISOString();

  it('uses the local date of startedAt, not the UTC date (late evening)', () => {
    const { entry } = entryFromStoppedTimer(stopped(lateEvening.toISOString()), nowIso);
    expect(entry.date).toBe(expectedLocal(lateEvening));
    expect(entry.date).toBe('2026-10-10');
  });
  it('uses the local date of startedAt, not the UTC date (just after midnight)', () => {
    const { entry } = entryFromStoppedTimer(stopped(justAfterMidnight.toISOString()), nowIso);
    expect(entry.date).toBe('2026-10-11');
  });
  it('falls back to the local date of nowIso when startedAt is missing', () => {
    const late = lateEvening.toISOString();
    const { entry } = entryFromStoppedTimer({ ...stopped(late), startedAt: null }, late);
    expect(entry.date).toBe('2026-10-10');
    const { entry: e2 } = entryFromStoppedTimer({ ...stopped(late), startedAt: null }, justAfterMidnight.toISOString());
    expect(e2.date).toBe('2026-10-11');
  });
  it('leaves the rest of the entry unchanged', () => {
    const r = entryFromStoppedTimer(stopped(lateEvening.toISOString()), nowIso);
    expect(r).toEqual({
      seconds: 600,
      entry: { clientId: 'c1', clientName: 'Acme', date: '2026-10-10', description: 'Design', seconds: 600, invoiced: false, createdAt: nowIso }
    });
  });
});
