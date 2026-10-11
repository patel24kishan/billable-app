import { describe, it, expect } from 'vitest';
import { IDLE_TIMER, TIMER_LABELS, sessionElapsedSeconds, startTimer, pauseTimer, resumeTimer, stopTimer, entryFromStoppedTimer } from '../../src/domain/timer.js';

const T0 = '2026-10-10T12:00:00.000Z';
const ms = (iso) => new Date(iso).getTime();
const T0ms = ms(T0);
const T2 = '2026-10-10T12:05:00.000Z';

const running = () => startTimer({ clientId: 'c1', clientName: 'Acme', description: 'Design' }, T0);
const deepFreeze = (o) => Object.freeze(o);

describe('timer domain', () => {
  it('IDLE_TIMER is the frozen idle doc', () => {
    expect(Object.isFrozen(IDLE_TIMER)).toBe(true);
    expect(IDLE_TIMER).toEqual({ status: 'idle', clientId: null, clientName: '', description: '', accumulatedSeconds: 0, segmentStartedAt: null, startedAt: null });
    expect(TIMER_LABELS).toEqual({ running: 'Tracking', paused: 'Paused', stopped: 'Ready to save' });
  });

  it('startTimer returns the full running doc', () => {
    expect(running()).toEqual({
      status: 'running', clientId: 'c1', clientName: 'Acme', description: 'Design',
      accumulatedSeconds: 0, segmentStartedAt: T0, startedAt: T0
    });
    expect(Object.keys(running())).toEqual(['status', 'clientId', 'clientName', 'description', 'accumulatedSeconds', 'segmentStartedAt', 'startedAt']);
  });

  it('sessionElapsedSeconds counts the running segment, otherwise returns accumulatedSeconds', () => {
    expect(sessionElapsedSeconds(running(), T0ms + 90000)).toBe(90);
    expect(sessionElapsedSeconds({ ...running(), status: 'paused', accumulatedSeconds: 42 }, T0ms + 90000)).toBe(42);
    expect(sessionElapsedSeconds({ ...running(), status: 'stopped', accumulatedSeconds: 43 }, T0ms + 90000)).toBe(43);
    expect(sessionElapsedSeconds(IDLE_TIMER, T0ms + 90000)).toBe(0);
  });

  it('sessionElapsedSeconds defaults to Date.now()', () => {
    const t = startTimer({ clientId: 'c', clientName: '', description: '' }, new Date(Date.now() - 10000).toISOString());
    expect(sessionElapsedSeconds(t)).toBeGreaterThanOrEqual(10);
  });

  it('pause, resume, stop', () => {
    const r = deepFreeze(running());
    const p = deepFreeze(pauseTimer(r, T0ms + 90000));
    expect(p).toEqual({ ...r, status: 'paused', accumulatedSeconds: 90, segmentStartedAt: null });
    expect(p.startedAt).toBe(T0);

    const r2 = deepFreeze(resumeTimer(p, T2));
    expect(r2).toEqual({ ...p, status: 'running', segmentStartedAt: T2 });
    expect(sessionElapsedSeconds(r2, ms(T2) + 30000)).toBe(120);

    const st = stopTimer(r2, ms(T2) + 30000);
    expect(st).toEqual({ ...r2, status: 'stopped', accumulatedSeconds: 120, segmentStartedAt: null });
  });

  it('stop from paused keeps the paused total; resume from stopped runs again', () => {
    const p = pauseTimer(running(), T0ms + 90000);
    const st = stopTimer(p, T0ms + 999999);
    expect(st.status).toBe('stopped');
    expect(st.accumulatedSeconds).toBe(90);
    const again = resumeTimer(st, T2);
    expect(again.status).toBe('running');
    expect(again.segmentStartedAt).toBe(T2);
    expect(again.accumulatedSeconds).toBe(90);
  });

  it('entryFromStoppedTimer rounds seconds and builds the entry', () => {
    const nowIso = '2026-10-10T15:00:00.000Z';
    const st = { ...running(), status: 'stopped', accumulatedSeconds: 120.4, segmentStartedAt: null };
    expect(entryFromStoppedTimer(st, nowIso)).toEqual({
      seconds: 120,
      entry: { clientId: 'c1', clientName: 'Acme', date: '2026-10-10', description: 'Design', seconds: 120, invoiced: false, createdAt: nowIso }
    });
    expect(entryFromStoppedTimer({ ...st, accumulatedSeconds: 0.4 }, nowIso).seconds).toBe(0);
    const noStart = entryFromStoppedTimer({ ...st, startedAt: null, description: '' }, nowIso);
    expect(noStart.entry.date).toBe('2026-10-10');
    expect(noStart.entry.description).toBe('');
  });

  it('no transition mutates its input', () => {
    const r = running();
    const snapshot = { ...r };
    pauseTimer(r, T0ms + 1000); resumeTimer(r, T2); stopTimer(r, T0ms + 1000); entryFromStoppedTimer(r, T2);
    expect(r).toEqual(snapshot);
    const frozenInput = Object.freeze({ ...r });
    expect(() => pauseTimer(frozenInput, T0ms + 1000)).not.toThrow();
  });
});
