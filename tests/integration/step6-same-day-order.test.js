// Step 6 (C2 + M1): same-day entries/expenses show newest first and stay in that
// order across reloads; invoice preview rows and the saved invoice's lineItems
// follow date asc, time before expense, createdAt asc.
// Driven through the real app (index.html + src/main.js).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(here, '../../index.html'), 'utf8');
const $ = (s) => document.querySelector(s);
const submit = (form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
const WAIT = { timeout: 4000, interval: 10 };

let state;

// Boot (or re-boot = simulated page reload) the app on the CURRENT IndexedDB.
async function boot() {
  vi.resetModules();
  document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  const main = await import('../../src/main.js');
  await main.appReady;
  ({ state } = await import('../../src/state.js'));
  await vi.waitFor(() => expect(state.store).toBeTruthy(), WAIT);
}

const descCol = (sel) => [...document.querySelectorAll(sel + ' tr')].map((tr) => tr.children[2].childNodes[0].textContent.trim());

describe('step 6: same-day ordering (C2 + M1)', () => {
  let clientId, month;

  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    await boot();
    $('#clientName').value = 'Acme';
    submit($('#clientForm'));
    await vi.waitFor(() => expect(state.clients.length).toBe(1), WAIT);
    clientId = state.clients[0].id;
    month = $('#invMonth').value;

    // Written in createdAt order with ids that sort OPPOSITE to createdAt, so
    // neither insertion order nor IndexedDB key order is the expected order.
    const day = month + '-05';
    const base = { clientId, clientName: 'Acme', invoiced: false };
    const E = [
      ['id_ez3', { ...base, date: day, seconds: 3600, description: 'Entry 1', createdAt: day + 'T09:00:00.000Z' }],
      ['id_ey2', { ...base, date: day, seconds: 3600, description: 'Entry 2', createdAt: day + 'T10:00:00.000Z' }],
      ['id_ex1', { ...base, date: day, seconds: 3600, description: 'Entry 3', createdAt: day + 'T11:00:00.000Z' }]
    ];
    // Expenses are created before every entry of the day, yet must follow them on the invoice.
    const X = [
      ['id_xz3', { ...base, date: day, amount: 10, title: 'Expense 1', createdAt: day + 'T01:00:00.000Z' }],
      ['id_xy2', { ...base, date: day, amount: 20, title: 'Expense 2', createdAt: day + 'T02:00:00.000Z' }],
      ['id_xx1', { ...base, date: day, amount: 30, title: 'Expense 3', createdAt: day + 'T03:00:00.000Z' }],
      // Earlier date, created last: first on the invoice, last in the list.
      ['id_xa0', { ...base, date: month + '-02', amount: 5, title: 'Expense 0', createdAt: day + 'T23:00:00.000Z' }]
    ];
    for (const [id, d] of E) await state.store.collection('entries').doc(id).set(d);
    for (const [id, d] of X) await state.store.collection('expenses').doc(id).set(d);
  });

  const LIST_ENTRIES = ['Entry 3', 'Entry 2', 'Entry 1'];
  const LIST_EXPENSES = ['Expense 3', 'Expense 2', 'Expense 1', 'Expense 0'];
  const INVOICE = ['Expense 0', 'Entry 1', 'Entry 2', 'Entry 3', 'Expense 1', 'Expense 2', 'Expense 3'];

  async function assertLists() {
    await vi.waitFor(() => expect(descCol('#entriesBody')).toEqual(LIST_ENTRIES), WAIT);
    expect(descCol('#expensesBody')).toEqual(LIST_EXPENSES);
    expect(state.entries.map((e) => e.description)).toEqual(LIST_ENTRIES);
    expect(state.expenses.map((x) => x.title)).toEqual(LIST_EXPENSES);
  }

  async function previewLabels() {
    state.invPreviewRows = null;
    $('#invClient').value = clientId;
    $('#invPreviewBtn').click();
    await vi.waitFor(() => expect(state.invPreviewRows).toBeTruthy(), WAIT);
    const dom = [...document.querySelectorAll('#invPreviewBody tr')].map((tr) => tr.children[1].childNodes[0].textContent.trim());
    const fromState = state.invPreviewRows.map((r) => (r.type === 'time' ? r.description : r.title));
    expect(dom).toEqual(fromState);
    return fromState;
  }

  it('lists are newest first within a day, stable across reloads', async () => {
    await assertLists();
    for (let i = 0; i < 4; i++) {
      await boot(); // fresh store on the same fake IndexedDB
      await assertLists();
    }
  });

  it('invoice preview and saved lineItems: date asc, time before expense, createdAt asc; stable across reloads', async () => {
    expect(await previewLabels()).toEqual(INVOICE);
    for (let i = 0; i < 3; i++) {
      await boot();
      expect(await previewLabels()).toEqual(INVOICE);
    }

    const save = vi.fn(async () => {});
    state.downloads = { save };
    $('#invGenerateBtn').click();
    await vi.waitFor(async () => expect((await state.store.collection('invoices').get()).docs.length).toBe(1), WAIT);
    await vi.waitFor(() => expect(state.invPreviewRows).toBeNull(), WAIT);
    await vi.waitFor(() => expect($('#invGenerateBtn').textContent).toBe('Generate PDF Invoice'), WAIT);
    const inv = (await state.store.collection('invoices').get()).docs[0].data();
    expect(inv.lineItems.map((l) => l.description)).toEqual(INVOICE);
    expect(inv.lineItems.map((l) => l.type)).toEqual(['expense', 'time', 'time', 'time', 'expense', 'expense', 'expense']);
    expect(save).toHaveBeenCalledTimes(1);

    // The stored order survives a reload too.
    await boot();
    const again = (await state.store.collection('invoices').get()).docs[0].data();
    expect(again.lineItems.map((l) => l.description)).toEqual(INVOICE);
  });
});
