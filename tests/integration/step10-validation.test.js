// Step 10 (Phase 3): validation and input parity (A3, C4, C6, C5, C3, A2, C8).
// Driven through the real app (index.html + src/main.js).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(here, '../../index.html'), 'utf8');
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const submit = (form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
const WAIT = { timeout: 4000, interval: 10 };
const flush = () => new Promise((r) => setTimeout(r, 150));
const waitFor = (fn) => vi.waitFor(fn, WAIT);

let state;
const toastIs = (text) => {
  expect($('#toast').hidden).toBe(false);
  expect($('#toast').textContent).toBe(text);
  expect($('#toast').classList.contains('error')).toBe(true);
};
const all = async (name) => (await state.store.collection(name).get()).docs.map((d) => ({ id: d.id, ...d.data() }));

async function addClient(name) {
  $('#clientName').value = name;
  submit($('#clientForm'));
  await waitFor(() => expect(state.clients.some((c) => c.name === name)).toBe(true));
  await waitFor(() => expect($('#clientName').value).toBe('')); // form reset = save settled
}

describe('step 10: validation and input parity', () => {
  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    vi.resetModules();
    document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    await import('../../src/main.js');
    ({ state } = await import('../../src/state.js'));
    await waitFor(() => expect(state.store).toBeTruthy());
    await waitFor(() => expect($('#taxProvince').options.length).toBe(13));
  });

  it('A3: whitespace-only client name shows a toast and stores nothing', async () => {
    $('#clientName').value = '   ';
    submit($('#clientForm'));
    toastIs('Enter a client name.');
    await flush();
    expect(await all('clients')).toEqual([]);
  });

  it('C4: expense with a whitespace title (or bad amount) shows a toast and stores nothing', async () => {
    await addClient('Acme');
    await waitFor(() => expect($('#expClient').value).toBeTruthy());
    $('#expTitle').value = '   '; $('#expAmount').value = '10';
    submit($('#expenseForm'));
    toastIs('Enter a title and a valid amount.');
    $('#toast').hidden = true;
    $('#expTitle').value = 'Taxi'; $('#expAmount').value = '0';
    submit($('#expenseForm'));
    toastIs('Enter a title and a valid amount.');
    await flush();
    expect(await all('expenses')).toEqual([]);
  });

  it('C6: edit-entry and edit-expense with an empty date toast, stay open, save nothing', async () => {
    await addClient('Acme');
    const clientId = state.clients[0].id;
    const en = await state.store.collection('entries').add({ clientId, clientName: 'Acme', date: '2026-10-05', seconds: 3600, description: 'x', invoiced: false, createdAt: '2026-10-05T00:00:00Z' });
    const ex = await state.store.collection('expenses').add({ clientId, clientName: 'Acme', date: '2026-10-05', title: 'Taxi', amount: 10, invoiced: false, createdAt: '2026-10-05T00:00:00Z' });
    await waitFor(() => expect($(`[data-edit-entry="${en.id}"]`)).toBeTruthy());
    await waitFor(() => expect($(`[data-edit-exp="${ex.id}"]`)).toBeTruthy());

    $(`[data-edit-entry="${en.id}"]`).click();
    expect($('#editEntryModal').hidden).toBe(false);
    $('#editEntryDate').value = '';
    $('#editEntryHours').value = '2';
    $('#editEntrySaveBtn').click();
    toastIs('Enter a valid date.');
    expect($('#editEntryModal').hidden).toBe(false);

    $('#toast').hidden = true;
    $(`[data-edit-exp="${ex.id}"]`).click();
    await waitFor(() => expect($('#editExpenseModal').hidden).toBe(false));
    $('#editExpenseDate').value = '';
    $('#editExpenseAmount').value = '99';
    $('#editExpenseSaveBtn').click();
    toastIs('Enter a valid date.');
    expect($('#editExpenseModal').hidden).toBe(false);

    await flush();
    const e = (await all('entries'))[0], x = (await all('expenses'))[0];
    expect([e.date, e.seconds]).toEqual(['2026-10-05', 3600]);
    expect([x.date, x.amount]).toEqual(['2026-10-05', 10]);
  });

  it('C5: manual hours 0.33 and 0.01 pass native validation (also edit-entry input); 0.33 saves as 1188 s', async () => {
    for (const sel of ['#manHours', '#editEntryHours']) {
      const input = $(sel);
      expect(input.getAttribute('step')).toBe('any');
      expect(input.getAttribute('min')).toBe('0.01');
      for (const v of ['0.33', '0.01']) { input.value = v; expect(input.checkValidity()).toBe(true); }
      input.value = '0'; expect(input.checkValidity()).toBe(false);
    }
    expect($('#manHours').required).toBe(true);
    await addClient('Acme');
    await waitFor(() => expect($('#manClient').value).toBeTruthy());
    $('#manHours').value = '0.33';
    expect($('#manualForm').checkValidity()).toBe(true);
    submit($('#manualForm'));
    await waitFor(async () => expect((await all('entries')).map((e) => e.seconds)).toEqual([1188]));
    await waitFor(() => expect($('#manHours').value).toBe(''));
  });

  it('C3: empty / zero manual hours show a toast and store nothing', async () => {
    await addClient('Acme');
    await waitFor(() => expect($('#manClient').value).toBeTruthy());
    for (const v of ['', '0']) {
      $('#toast').hidden = true;
      $('#manHours').value = v;
      submit($('#manualForm'));
      toastIs('Enter a valid number of hours.');
    }
    await flush();
    expect(await all('entries')).toEqual([]);
  });

  it('A2: client list is case-insensitive (acme, Beta, Zed); ties are deterministic', async () => {
    for (const n of ['Zed', 'acme', 'Beta']) await addClient(n);
    const names = () => $$('#clientList .client-name').map((e) => e.textContent);
    await waitFor(() => expect(names()).toEqual(['acme', 'Beta', 'Zed']));
    expect($$('#manClient option').map((o) => o.textContent)).toEqual(['acme', 'Beta', 'Zed']);
    await addClient('ACME');
    await waitFor(() => expect(names().length).toBe(4));
    const tie = state.clients.filter((c) => c.name.toLowerCase() === 'acme').map((c) => c.id);
    expect(tie).toEqual([...tie].sort());
  });

  it('C8: starting a timer while one is running does not overwrite it', async () => {
    await addClient('Acme');
    await addClient('Beta');
    await waitFor(() => expect($('#timerClient').value).toBeTruthy());
    $('#timerClient').value = state.clients.find((c) => c.name === 'Acme').id;
    $('#startTimerBtn').click();
    await waitFor(() => expect(state.timer.status).toBe('running'));
    await waitFor(() => expect($('#timerNote').value).toBe(''));
    const first = { ...state.timer };
    await new Promise((r) => setTimeout(r, 30));
    $('#timerClient').value = state.clients.find((c) => c.name === 'Beta').id;
    $('#startTimerBtn').click();
    await flush();
    const stored = (await state.store.doc('state/timer').get()).data();
    expect(stored.startedAt).toBe(first.startedAt);
    expect(stored.clientName).toBe('Acme');
    expect(state.timer).toEqual(first);
    // settle: discard the session so no timers/writes outlive the test
    $('#discardTimerBtn').click();
    await waitFor(() => expect($('#confirmModal').hidden).toBe(false));
    $('#confirmOkBtn').click();
    await waitFor(() => expect(state.timer.status).toBe('idle'));
  });
});
