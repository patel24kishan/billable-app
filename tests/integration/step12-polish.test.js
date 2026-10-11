// Step 12 (Phase 5: B9, C9): invoice history limit 200, entries-list label and 'h' suffix,
// live timer state in document.title. Driven through the real app.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(here, '../../index.html'), 'utf8');
const $ = (s) => document.querySelector(s);
const submit = (form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
const WAIT = { timeout: 60000, interval: 10 };

let state;

async function boot() {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
  document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  await import('../../src/main.js');
  await vi.waitFor(() => expect($('#taxProvince').options.length).toBe(13), WAIT);
  ({ state } = await import('../../src/state.js'));
  await vi.waitFor(() => expect(state.store).toBeTruthy(), WAIT);
}

async function addClient(name) {
  $('#clientName').value = name;
  submit($('#clientForm'));
  await vi.waitFor(() => expect(Array.from($('#timerClient').options).map((o) => o.textContent)).toContain(name), WAIT);
  await vi.waitFor(() => expect($('#clientName').value).toBe(''), WAIT);
}

describe('step 12 / B9: invoice history limit', () => {
  beforeEach(boot);

  it('shows 200 of 201 saved invoices', async () => {
    for (let i = 1; i <= 201; i++) {
      await state.store.collection('invoices').add({
        number: i, clientName: 'Acme', month: '2026-10', totalHours: 1, currency: '$', totalAmount: 65,
        generatedAt: new Date(Date.UTC(2026, 9, 1) + i * 1000).toISOString()
      });
    }
    await vi.waitFor(() => expect($('#invoicesBody').querySelectorAll('tr').length).toBe(200), WAIT);
    expect(state.invoices.length).toBe(200);
    // newest first: #0201 is shown, the oldest (#0001) is the one cut off
    expect($('#invoicesBody').textContent).toContain('#0201');
    expect($('#invoicesBody').textContent).not.toContain('#0001');
  }, 90000);
});

describe('step 12 / C9: entries list', () => {
  beforeEach(boot);

  it('shows "No description" for a blank description and an h suffix on hours', async () => {
    await state.store.collection('entries').add({ clientId: 'c', clientName: 'Acme', date: '2026-10-09', seconds: 4500, description: '', invoiced: false, createdAt: '2026-10-09T10:00:00.000Z' });
    await state.store.collection('entries').add({ clientId: 'c', clientName: 'Acme', date: '2026-10-08', seconds: 3600, description: 'Design', invoiced: false, createdAt: '2026-10-08T10:00:00.000Z' });
    await vi.waitFor(() => expect($('#entriesBody').querySelectorAll('tr').length).toBe(2), WAIT);
    const rows = Array.from($('#entriesBody').querySelectorAll('tr'));
    expect(rows[0].children[2].textContent).toBe('No description');
    expect(rows[0].querySelector('.hours').textContent).toBe('1.25h');
    expect(rows[0].textContent).toContain('Oct 9, 2026');
    expect(rows[1].children[2].textContent).toBe('Design');
    expect(rows[1].querySelector('.hours').textContent).toBe('1.00h');
  });
});

describe('step 12 / C9: timer in document.title', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date(2026, 9, 10, 9, 0, 0));
    await boot();
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  async function startTimer() {
    await addClient('Acme');
    expect(document.title).toBe('Billable');
    $('#startTimerBtn').click();
    await vi.waitFor(() => expect($('#timerActive').hidden).toBe(false), WAIT);
  }

  it('follows running -> paused -> stopped and is restored on save', async () => {
    await startTimer();
    expect(document.title).toBe('▶ 00:00:00 — Acme · Billable');
    vi.advanceTimersByTime(723000); // 12m03s: the 1 s interval fires 723 times
    expect(document.title).toBe('▶ 00:12:03 — Acme · Billable');
    vi.advanceTimersByTime(1000);
    expect(document.title).toBe('▶ 00:12:04 — Acme · Billable');

    $('#pauseTimerBtn').click();
    await vi.waitFor(() => expect($('#resumeTimerBtn')).not.toBeNull(), WAIT);
    expect(document.title).toBe('⏸ 00:12:04 — Acme · Billable');

    $('#resumeTimerBtn').click();
    await vi.waitFor(() => expect($('#pauseTimerBtn')).not.toBeNull(), WAIT);
    expect(document.title).toBe('▶ 00:12:04 — Acme · Billable');
    vi.advanceTimersByTime(1000);
    expect(document.title).toBe('▶ 00:12:05 — Acme · Billable');

    $('#stopTimerBtn').click();
    await vi.waitFor(() => expect($('#saveTimerBtn')).not.toBeNull(), WAIT);
    expect(document.title).toBe('■ 00:12:05 — Acme · Billable');

    $('#saveTimerBtn').click();
    await vi.waitFor(() => expect($('#timerActive').hidden).toBe(true), WAIT);
    expect(document.title).toBe('Billable');
  });

  it('is restored on discard', async () => {
    await startTimer();
    vi.advanceTimersByTime(5000);
    expect(document.title).toBe('▶ 00:00:05 — Acme · Billable');
    $('#discardTimerBtn').click();
    await vi.waitFor(() => expect($('#confirmModal').hidden).toBe(false), WAIT);
    $('#confirmOkBtn').click();
    await vi.waitFor(() => expect($('#timerActive').hidden).toBe(true), WAIT);
    expect(document.title).toBe('Billable');
  });
});
