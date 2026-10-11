// Step 1 (C1): a timer-saved entry is dated by the LOCAL calendar day of
// startedAt, driven through the real app (index.html + src/main.js).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fmtDateShort } from '../../src/domain/dates.js';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(here, '../../index.html'), 'utf8');
const $ = (s) => document.querySelector(s);
const submit = (form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
const WAIT = { timeout: 4000, interval: 10 };

describe('step 1: timer entry date is the local date', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('start -> pause -> stop -> save under local 23:30 saves that local day', async () => {
    // Local 23:30 on Oct 10: west of UTC the UTC date is already Oct 11.
    const start = new Date(2026, 9, 10, 23, 30, 0);
    vi.setSystemTime(start);
    await import('../../src/main.js');
    await vi.waitFor(() => expect($('#taxProvince').options.length).toBe(13), WAIT);

    $('#clientName').value = 'Acme';
    submit($('#clientForm'));
    await vi.waitFor(() => expect(Array.from($('#timerClient').options).map((o) => o.textContent)).toContain('Acme'), WAIT);

    $('#startTimerBtn').click();
    await vi.waitFor(() => expect($('#timerActive').hidden).toBe(false), WAIT);

    // Session runs past local midnight (into Oct 11), then pause, stop, save.
    vi.setSystemTime(new Date(2026, 9, 11, 0, 10, 0));
    $('#pauseTimerBtn').click();
    await vi.waitFor(() => expect($('#resumeTimerBtn')).not.toBeNull(), WAIT);
    $('#stopTimerBtn').click();
    await vi.waitFor(() => expect($('#saveTimerBtn')).not.toBeNull(), WAIT);
    $('#saveTimerBtn').click();

    await vi.waitFor(() => expect($('#entriesBody').querySelectorAll('tr').length).toBe(1), WAIT);
    const row = $('#entriesBody tr').textContent;
    expect(row).toContain(fmtDateShort('2026-10-10')); // the day it started, locally
    expect(row).not.toContain(fmtDateShort('2026-10-11'));
    expect(row).toContain('Acme');
  });
});
