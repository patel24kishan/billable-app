// Step 13b: UI requests. 13b-1 Edit on every invoice preview line (time rows too),
// 13b-2 numeric column alignment, 13b-3 Track layout order, 13b-4 Recent entries
// month filter. Driven through the real app (jsdom + fake-indexeddb).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(here, '../../index.html'), 'utf8');
const css = readFileSync(resolve(here, '../../src/style.css'), 'utf8');
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const submit = (form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
const change = (el) => el.dispatchEvent(new Event('change', { bubbles: true }));
const WAIT = { timeout: 4000, interval: 10 };
const flush = () => new Promise((r) => setTimeout(r, 150));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const RC = { receiptData: PNG, receiptType: 'image/png', receiptW: 1, receiptH: 1 };

let state, clientId;

async function boot() {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
  document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  await import('../../src/main.js');
  await vi.waitFor(() => expect($('#taxProvince').options.length).toBe(13), WAIT);
  ({ state } = await import('../../src/state.js'));
  await vi.waitFor(() => expect(state.store).toBeTruthy(), WAIT);
  $('#clientName').value = 'Acme';
  submit($('#clientForm'));
  await vi.waitFor(() => expect(state.clients.some((c) => c.name === 'Acme')).toBe(true), WAIT);
  clientId = state.clients[0].id;
  $('#setRate').value = '65';
  $('#taxCountry').value = 'Canada';
  change($('#taxCountry'));
  $('#taxProvince').value = 'Ontario';
  change($('#taxProvince'));
  $('#saveSettingsBtn').click();
  await vi.waitFor(() => expect(state.settings.rate).toBe(65), WAIT);
  await vi.waitFor(() => expect($('#taxPreview').textContent).toBe('Applied to invoices: HST 13%'), WAIT);
}

const addEntry = (date, hours, description, createdAt) =>
  state.store.collection('entries').add({ clientId, clientName: 'Acme', date, seconds: Math.round(hours * 3600), description, invoiced: false, createdAt: createdAt || date + 'T12:00:00.000Z' });
const addExpense = (date, title, extra) =>
  state.store.collection('expenses').add(Object.assign({ clientId, clientName: 'Acme', date, title, amount: 10, invoiced: false, createdAt: date + 'T12:00:00.000Z' }, extra));
const toastIs = (text) => vi.waitFor(() => { expect($('#toast').hidden).toBe(false); expect($('#toast').textContent).toBe(text); }, WAIT);
const fmt = (iso) => { const p = iso.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
function prevMonth(m) {
  const [y, mo] = m.split('-').map(Number);
  return mo === 1 ? (y - 1) + '-12' : y + '-' + String(mo - 1).padStart(2, '0');
}

/* ------------------------------------------------------------------ 13b-1 */
describe('step 13b-1: Edit on every invoice preview line', () => {
  let month, ids;

  beforeEach(async () => {
    await boot();
    month = $('#invMonth').value;
    ids = {
      task: (await addEntry(month + '-01', 1, 'Task')).id,
      alpha: (await addExpense(month + '-02', 'Alpha', RC)).id,
      beta: (await addExpense(month + '-03', 'Beta', RC)).id,
      gamma: (await addExpense(month + '-04', 'Gamma', {})).id,
    };
  });

  async function preview() {
    $('#invClient').value = clientId;
    $('#invPreviewBtn').click();
    await vi.waitFor(() => expect($('#invPreviewWrap').hidden).toBe(false), WAIT);
    await vi.waitFor(() => expect(state.invPreviewRows && state.invPreviewRows.length).toBe(4), WAIT);
  }
  const entryBtn = (id) => $('#invPreviewBody [data-edit-preview-entry="' + id + '"]');
  const box = (id) => $('#invPreviewBody input[data-attach-receipt="' + id + '"]');
  const tick = (b, v) => { b.checked = v; change(b); };
  const footer = () => $$('#invTotalsFoot tr').map((tr) => tr.querySelector('td.amount').textContent);
  const footHours = () => $('#invTotalsFoot td.hours').textContent;
  const stored = async (id) => (await state.store.collection('entries').doc(id).get()).data();

  async function openEntryFromPreview(id) {
    entryBtn(id).click();
    await vi.waitFor(() => expect($('#editEntryModal').hidden).toBe(false), WAIT);
    expect($('#editEntryId').value).toBe(id);
  }
  // Saves the entry modal and waits for the preview reload (the rows array is replaced).
  async function saveEntryAndReload() {
    const before = state.invPreviewRows;
    $('#editEntrySaveBtn').click();
    await vi.waitFor(() => expect($('#editEntryModal').hidden).toBe(true), WAIT);
    await vi.waitFor(() => expect(state.invPreviewRows).not.toBe(before), WAIT);
  }

  it('every row has one Edit button in a dedicated last column; labels; D1 checkbox stays in the description', async () => {
    await preview();
    const rows = $$('#invPreviewBody tr');
    expect(rows.length).toBe(4);
    rows.forEach((tr) => {
      expect(tr.cells.length).toBe(5);
      const last = tr.cells[4];
      expect(last.classList.contains('col-actions')).toBe(true);
      expect(last.querySelectorAll('button').length).toBe(1);
      expect(last.querySelector('button').title).toBe('Edit');
      // no Edit button anywhere else in the row
      expect(tr.querySelectorAll('button').length).toBe(1);
    });
    expect(rows[0].cells[4].querySelector('button').dataset.editPreviewEntry).toBe(ids.task);
    expect(rows[0].cells[4].querySelector('button').getAttribute('aria-label')).toBe('Edit time entry ' + fmt(month + '-01'));
    expect(rows.slice(1).map((tr) => tr.cells[4].querySelector('button').dataset.editPreviewExp)).toEqual([ids.alpha, ids.beta, ids.gamma]);
    expect(rows[1].cells[4].querySelector('button').getAttribute('aria-label')).toBe('Edit expense Alpha');
    // D1 checkbox still in the description cell
    expect(rows[1].cells[1].querySelector('input[data-attach-receipt="' + ids.alpha + '"]')).toBeTruthy();
    expect(rows[3].cells[1].querySelector('input')).toBeNull();
    // header: last cell is the empty actions header; footer rows span all 5 columns
    const ths = $$('#invPreviewWrap thead th');
    expect(ths.length).toBe(5);
    expect(ths[4].classList.contains('col-actions')).toBe(true);
    expect(ths[4].textContent).toBe('');
    $$('#invTotalsFoot tr').forEach((tr) => {
      expect([...tr.cells].reduce((n, c) => n + c.colSpan, 0)).toBe(5);
      expect(tr.cells[tr.cells.length - 1].classList.contains('col-actions')).toBe(true);
    });
    expect(footer()).toEqual(['$95.00', '$12.35', '$107.35']);
  });

  it('editing a time row: modal opens, hours/description update the row, footer and stored entry; an unticked receipt stays unticked', async () => {
    await preview();
    tick(box(ids.beta), false);
    await openEntryFromPreview(ids.task);
    expect($('#editEntryHours').value).toBe('1');
    expect($('#editEntryDesc').value).toBe('Task');
    expect($('#editExpenseModal').hidden).toBe(true);
    $('#editEntryHours').value = '2';
    $('#editEntryDesc').value = 'Task edited';
    await saveEntryAndReload();
    await toastIs('Entry updated.');

    const row = $$('#invPreviewBody tr')[0];
    expect(row.cells[1].textContent).toBe('Task edited');
    expect(row.cells[2].textContent).toBe('2.00');
    expect(row.cells[3].textContent).toBe('$130.00');
    // 130 + 30 = 160; HST 13% = 20.80; total 180.80
    expect(footer()).toEqual(['$160.00', '$20.80', '$180.80']);
    expect(footHours()).toBe('2.00 hrs');
    expect(box(ids.beta).checked).toBe(false);
    expect(box(ids.alpha).checked).toBe(true);
    expect(await stored(ids.task)).toMatchObject({ seconds: 7200, description: 'Task edited', date: month + '-01' });
  });

  it('moving the entry date out of the month drops the row with a neutral toast', async () => {
    await preview();
    tick(box(ids.alpha), false);
    await openEntryFromPreview(ids.task);
    $('#editEntryDate').value = prevMonth(month) + '-15';
    await saveEntryAndReload();
    await toastIs('Entry moved out of this invoice period.');
    expect($('#toast').className).toBe('toast');
    expect(state.invPreviewRows.length).toBe(3);
    expect(entryBtn(ids.task)).toBeNull();
    expect(footer()).toEqual(['$30.00', '$3.90', '$33.90']);
    expect(box(ids.alpha).checked).toBe(false);
    expect(await stored(ids.task)).toMatchObject({ date: prevMonth(month) + '-15' });
  });

  it('an entry edit that stays in the month does not toast "moved out"', async () => {
    await preview();
    await openEntryFromPreview(ids.task);
    $('#editEntryDate').value = month + '-20';
    await saveEntryAndReload();
    await flush();
    expect($('#toast').textContent).toBe('Entry updated.');
    expect(state.invPreviewRows.map((r) => r.id)).toEqual([ids.alpha, ids.beta, ids.gamma, ids.task]);
  });

  it('an entry edit with no preview showing does not touch the preview', async () => {
    await vi.waitFor(() => expect($('#entriesBody [data-edit-entry="' + ids.task + '"]')).toBeTruthy(), WAIT);
    $('#entriesBody [data-edit-entry="' + ids.task + '"]').click();
    await vi.waitFor(() => expect($('#editEntryModal').hidden).toBe(false), WAIT);
    $('#editEntryHours').value = '3';
    $('#editEntrySaveBtn').click();
    await vi.waitFor(() => expect($('#editEntryModal').hidden).toBe(true), WAIT);
    await toastIs('Entry updated.');
    await flush();
    expect(state.invPreviewRows).toBeNull();
    expect(state.invPreviewMeta).toBeNull();
    expect($('#invPreviewWrap').hidden).toBe(true);

    // a cleared preview (B3) is not brought back either
    await preview();
    $('#invIncludeBilled').checked = true;
    change($('#invIncludeBilled'));
    expect($('#invPreviewWrap').hidden).toBe(true);
    $('#entriesBody [data-edit-entry="' + ids.task + '"]').click();
    await vi.waitFor(() => expect($('#editEntryModal').hidden).toBe(false), WAIT);
    $('#editEntryHours').value = '4';
    $('#editEntrySaveBtn').click();
    await vi.waitFor(() => expect($('#editEntryModal').hidden).toBe(true), WAIT);
    await flush();
    expect(state.invPreviewRows).toBeNull();
    expect($('#invPreviewWrap').hidden).toBe(true);
    expect((await stored(ids.task)).seconds).toBe(4 * 3600);
  });

  it('opens an entry that is not in the Track list window (store fallback, beyond the newest 200)', async () => {
    // 200 newer entries push "Task" (the oldest) out of the Recent entries window
    for (let i = 0; i < 200; i++) await addEntry(month + '-28', 0.1, 'Newer ' + i, '2030-01-01T00:00:00.' + String(i).padStart(3, '0') + 'Z');
    await vi.waitFor(() => expect(state.entries.length).toBe(200), { timeout: 30000, interval: 10 });
    expect(state.entries.some((e) => e.id === ids.task)).toBe(false);
    $('#invClient').value = clientId;
    $('#invPreviewBtn').click();
    await vi.waitFor(() => expect(state.invPreviewRows && state.invPreviewRows.length).toBe(204), WAIT);
    await openEntryFromPreview(ids.task);
    expect($('#editEntryHours').value).toBe('1');
    expect($('#editEntryDesc').value).toBe('Task');
    $('#editEntryHours').value = '1.5';
    await saveEntryAndReload();
    expect((await stored(ids.task)).seconds).toBe(5400);
    expect($$('#invPreviewBody tr')[0].cells[2].textContent).toBe('1.50');
  }, 60000);
});

/* ------------------------------------------------------------------ 13b-2 */
describe('step 13b-2: numeric column alignment', () => {
  beforeEach(async () => {
    await boot();
    const month = $('#invMonth').value;
    await addEntry(month + '-01', 31.5, 'Long');
    await addEntry(month + '-02', 0.5, 'Short');
    await addExpense(month + '-03', 'Alpha', RC);
    await state.store.collection('invoices').add({ number: 1, clientName: 'Acme', month, totalHours: 32, totalAmount: 2080, grandTotal: 2350.4, currency: '$', generatedAt: '2026-10-01T10:00:00.000Z' });
    $('#invClient').value = clientId;
    $('#invPreviewBtn').click();
    await vi.waitFor(() => expect(state.invPreviewRows && state.invPreviewRows.length).toBe(3), WAIT);
    await vi.waitFor(() => expect($('#entriesBody').rows.length).toBe(2), WAIT);
    await vi.waitFor(() => expect($('#expensesBody').rows.length).toBe(1), WAIT);
    await vi.waitFor(() => expect($('#invoicesBody').rows.length).toBe(1), WAIT);
    // the app stylesheet, so computed alignment can be compared too
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  });

  // [table body id, column index, alignment class]
  const NUMERIC = [
    ['#invPreviewBody', 2, 'hours'], ['#invPreviewBody', 3, 'amount'],
    ['#entriesBody', 3, 'hours'],
    ['#expensesBody', 3, 'amount'],
    ['#invoicesBody', 3, 'hours'], ['#invoicesBody', 4, 'amount'],
  ];

  it.each(NUMERIC)('%s column %i: header and values share the "%s" class and right alignment', (body, col, cls) => {
    const table = $(body).closest('table');
    const th = table.tHead.rows[0].cells[col];
    const td = $(body).rows[0].cells[col];
    expect(td.classList.contains(cls)).toBe(true);
    expect(th.classList.contains(cls)).toBe(true);
    expect(getComputedStyle(td).textAlign).toBe('right');
    expect(getComputedStyle(th).textAlign).toBe('right');
  });

  it('text headers stay left-aligned', () => {
    const th = $('#invPreviewBody').closest('table').tHead.rows[0].cells[1];
    expect(th.className).toBe('');
    expect(getComputedStyle(th).textAlign).toBe('left');
  });

  it('preview footer: hours cell holds the full "<n> hrs" text in the Hours column; amounts in the Amount column', () => {
    const rows = [...$('#invTotalsFoot').rows];
    const sub = rows[0];
    // label spans Date+Description, so cells[1] is the Hours column, cells[2] the Amount column
    expect(sub.cells[0].colSpan).toBe(2);
    expect(sub.cells[1].classList.contains('hours')).toBe(true);
    expect(sub.cells[1].textContent).toBe('32.00 hrs');
    expect(getComputedStyle(sub.cells[1]).whiteSpace).toBe('nowrap');
    rows.forEach((tr) => {
      expect(tr.cells[2].classList.contains('amount')).toBe(true);
      expect(getComputedStyle(tr.cells[2]).textAlign).toBe('right');
    });
  });

  it('the preview has an empty actions header cell after Amount', () => {
    const ths = [...$('#invPreviewBody').closest('table').tHead.rows[0].cells];
    expect(ths.map((t) => t.textContent)).toEqual(['Date', 'Description', 'Hours', 'Amount', '']);
    expect(ths[4].classList.contains('col-actions')).toBe(true);
  });
});

/* ------------------------------------------------------------------ 13b-3 */
describe('step 13b-3: Track Time layout order', () => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const card = (sel) => doc.querySelector('#view-track ' + sel).closest('.card');

  it('timer, log time by hand, recent entries, log an expense, recent expenses', () => {
    const cards = [...doc.querySelectorAll('#view-track > .card')];
    const order = [card('#timerIdle'), card('#manualForm'), card('#entriesBody'), card('#expenseForm'), card('#expensesBody')];
    expect(cards).toEqual(order);
    expect(cards.map((c) => (c.querySelector('.card-title') || {}).textContent)).toEqual([undefined, 'Log time by hand', 'Recent entries', 'Log an expense', 'Recent expenses']);
  });

  it('ids are unchanged', () => {
    const IDS = ['timerIdle', 'timerActive', 'timerClient', 'timerNote', 'startTimerBtn', 'manualForm', 'manClient', 'manDate', 'manHours', 'manDesc',
      'entriesTable', 'entriesBody', 'entriesEmpty', 'expenseForm', 'expClient', 'expDate', 'expTitle', 'expAmount', 'expReceipt', 'expSubmitBtn',
      'expensesBody', 'expensesEmpty', 'invPreviewWrap', 'invPreviewBody', 'invTotalsFoot', 'invReceiptChoice', 'invAttachAllBtn', 'invAttachNoneBtn',
      'invPreviewEmpty', 'invTaxJurisdiction', 'invGenerateBtn', 'invoicesBody', 'invoicesEmpty'];
    IDS.forEach((id) => expect(doc.getElementById(id), id).toBeTruthy());
  });
});

/* ------------------------------------------------------------------ 13b-4 */
describe('step 13b-4: Recent entries month filter', () => {
  beforeEach(async () => {
    await boot();
    await addEntry('2026-10-05', 1, 'Oct A');
    await addEntry('2026-10-20', 1.5, 'Oct B');
    await addEntry('2026-10-31', 0.25, 'Oct C');
    await addEntry('2026-09-01', 2, 'Sep A');
    await addEntry('2026-09-30', 0.33, 'Sep B');
    await addEntry('2026-11-01', 4, 'Nov A');
    await vi.waitFor(() => expect($('#entriesBody').rows.length).toBe(6), WAIT);
  });

  const descs = () => [...$('#entriesBody').rows].map((tr) => tr.cells[2].childNodes[0].textContent.trim());
  const summary = () => $('#entriesMonthSummary');
  async function pick(month) {
    $('#entriesMonth').value = month;
    change($('#entriesMonth'));
    if (month) await vi.waitFor(() => expect(summary().hidden).toBe(false), WAIT);
  }
  async function addByHand(date, hours, desc) {
    $('#manClient').value = clientId;
    $('#manDate').value = date;
    $('#manHours').value = String(hours);
    $('#manDesc').value = desc;
    submit($('#manualForm'));
    await toastIs('Entry added.');
    await vi.waitFor(() => expect($('#manHours').value).toBe(''), WAIT);
  }

  it('has a labelled month picker and an All months button; default is all months', () => {
    expect($('#entriesMonth').type).toBe('month');
    expect($('label[for="entriesMonth"]').textContent).toBe('Month');
    expect($('#entriesAllMonthsBtn').textContent).toBe('All months');
    expect($('#entriesMonth').value).toBe('');
    expect(summary().hidden).toBe(true);
    expect(descs()).toEqual(['Nov A', 'Oct C', 'Oct B', 'Oct A', 'Sep B', 'Sep A']);
  });

  it('filters by month (first..last day, newest first) with a total, empty month message, and All months restores', async () => {
    await pick('2026-10');
    await vi.waitFor(() => expect(descs()).toEqual(['Oct C', 'Oct B', 'Oct A']), WAIT);
    expect(summary().textContent).toBe('October 2026 · 2.75h');

    await pick('2026-09');
    await vi.waitFor(() => expect(descs()).toEqual(['Sep B', 'Sep A']), WAIT);
    expect(summary().textContent).toBe('September 2026 · 2.33h');

    await pick('2026-08');
    await vi.waitFor(() => expect(descs()).toEqual([]), WAIT);
    expect($('#entriesMonthEmpty').hidden).toBe(false);
    expect($('#entriesMonthEmpty').textContent).toBe('No time logged in August 2026.');
    expect($('#entriesEmpty').hidden).toBe(true);
    expect(summary().textContent).toBe('August 2026 · 0.00h');

    $('#entriesAllMonthsBtn').click();
    await vi.waitFor(() => expect(descs()).toEqual(['Nov A', 'Oct C', 'Oct B', 'Oct A', 'Sep B', 'Sep A']), WAIT);
    expect(summary().hidden).toBe(true);
    expect($('#entriesMonth').value).toBe('');
    expect($('#entriesMonthEmpty').hidden).toBe(true);
    expect($('#entriesEmpty').hidden).toBe(true);
  });

  it('same-day order inside a month follows C2 (createdAt desc)', async () => {
    await addEntry('2026-10-20', 1, 'Oct B later', '2026-10-20T18:00:00.000Z');
    await pick('2026-10');
    await vi.waitFor(() => expect(descs()).toEqual(['Oct C', 'Oct B later', 'Oct B', 'Oct A']), WAIT);
  });

  it('the filter persists across add, edit and delete', async () => {
    await pick('2026-10');
    await vi.waitFor(() => expect(descs()).toEqual(['Oct C', 'Oct B', 'Oct A']), WAIT);

    await addByHand('2026-09-15', 3, 'Sep new');
    await flush();
    expect(descs()).toEqual(['Oct C', 'Oct B', 'Oct A']);
    expect(summary().textContent).toBe('October 2026 · 2.75h');

    await addByHand('2026-10-10', 2, 'Oct new');
    await vi.waitFor(() => expect(descs()).toEqual(['Oct C', 'Oct B', 'Oct new', 'Oct A']), WAIT);
    expect(summary().textContent).toBe('October 2026 · 4.75h');

    // edit hours from the list: still filtered, total updated
    const octB = state.entries.find((e) => e.description === 'Oct B').id;
    $('#entriesBody [data-edit-entry="' + octB + '"]').click();
    await vi.waitFor(() => expect($('#editEntryModal').hidden).toBe(false), WAIT);
    $('#editEntryHours').value = '2.5';
    $('#editEntrySaveBtn').click();
    await vi.waitFor(() => expect($('#editEntryModal').hidden).toBe(true), WAIT);
    await toastIs('Entry updated.');
    await vi.waitFor(() => expect(summary().textContent).toBe('October 2026 · 5.75h'), WAIT);
    expect(descs()).toEqual(['Oct C', 'Oct B', 'Oct new', 'Oct A']);

    // edit the date out of the month: the row leaves the filtered list
    $('#entriesBody [data-edit-entry="' + octB + '"]').click();
    await vi.waitFor(() => expect($('#editEntryModal').hidden).toBe(false), WAIT);
    $('#editEntryDate').value = '2026-09-20';
    $('#editEntrySaveBtn').click();
    await vi.waitFor(() => expect($('#editEntryModal').hidden).toBe(true), WAIT);
    await vi.waitFor(() => expect(descs()).toEqual(['Oct C', 'Oct new', 'Oct A']), WAIT);
    expect(summary().textContent).toBe('October 2026 · 3.25h');

    // delete
    const octA = state.entries.find((e) => e.description === 'Oct A').id;
    $('#entriesBody [data-del-entry="' + octA + '"]').click();
    $('#confirmOkBtn').click();
    await vi.waitFor(() => expect(descs()).toEqual(['Oct C', 'Oct new']), WAIT);
    expect(summary().textContent).toBe('October 2026 · 2.25h');
    expect($('#entriesMonth').value).toBe('2026-10');
  });

  it('a timer save while filtered to its month shows up, and the filter stays', async () => {
    const startedAt = new Date(Date.now() - 3600 * 1000);
    const month = startedAt.getFullYear() + '-' + String(startedAt.getMonth() + 1).padStart(2, '0');
    await pick(month);
    const before = descs();
    await state.store.doc('state/timer').set({ status: 'stopped', clientId, clientName: 'Acme', description: 'Timed', startedAt: startedAt.toISOString(), accumulatedSeconds: 3600, segmentStartedAt: null });
    await vi.waitFor(() => expect($('#saveTimerBtn')).toBeTruthy(), WAIT);
    $('#saveTimerBtn').click();
    await toastIs('Saved 1 hours to Acme.');
    await vi.waitFor(() => expect(state.timer.status).toBe('idle'), WAIT);
    await vi.waitFor(() => expect(descs()).toContain('Timed'), WAIT);
    expect(descs().length).toBe(before.length + 1);
    expect($('#entriesMonth').value).toBe(month);
    expect(summary().hidden).toBe(false);
  });

  it('the invoice preview is unaffected by the filter', async () => {
    await pick('2026-10');
    await vi.waitFor(() => expect(descs()).toEqual(['Oct C', 'Oct B', 'Oct A']), WAIT);
    $('#invClient').value = clientId;
    $('#invMonth').value = '2026-09';
    change($('#invMonth'));
    $('#invPreviewBtn').click();
    await vi.waitFor(() => expect(state.invPreviewRows && state.invPreviewRows.length).toBe(2), WAIT);
    expect(state.invPreviewRows.map((r) => r.description)).toEqual(['Sep A', 'Sep B']);
    expect($('#invTotalsFoot td.hours').textContent).toBe('2.33 hrs');
    // and the filter is still in place
    expect(descs()).toEqual(['Oct C', 'Oct B', 'Oct A']);
    expect($('#entriesMonth').value).toBe('2026-10');
  });
});
