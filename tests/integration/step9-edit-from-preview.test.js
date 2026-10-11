// Step 9 (D2): edit an expense from the invoice preview; the preview reloads with
// the same client, month and receipt ticks. Driven through the real app.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// jsdom cannot decode images: stub only the compressor, locally to this file.
vi.mock('../../src/lib/receipts.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    fileToCompressedDataUrl: async (file) => ({ dataUrl: 'data:image/png;base64,NEW_' + file.name, type: 'image/png', width: 1, height: 1 }),
  };
});

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(here, '../../index.html'), 'utf8');
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const submit = (form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
const change = (el) => el.dispatchEvent(new Event('change', { bubbles: true }));
const WAIT = { timeout: 4000, interval: 10 };
const flush = () => new Promise((r) => setTimeout(r, 150));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const RC = { receiptData: PNG, receiptType: 'image/png', receiptW: 1, receiptH: 1 };

let state, invoicesUi, clientId, month, ids;

async function setup() {
  ({ state } = await import('../../src/state.js'));
  invoicesUi = await import('../../src/ui/invoices.js');
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
  month = $('#invMonth').value;
  await state.store.collection('entries').add({ clientId, clientName: 'Acme', date: month + '-01', seconds: 3600, description: 'Task', invoiced: false });
  const ex = (title, day, extra) => state.store.collection('expenses').add(Object.assign({ clientId, clientName: 'Acme', date: month + '-' + day, title, amount: 10, invoiced: false, createdAt: '2026-01-01T00:00:0' + day.slice(1) + 'Z' }, extra));
  ids = {
    alpha: (await ex('Alpha', '02', RC)).id,
    beta: (await ex('Beta', '03', RC)).id,
    gamma: (await ex('Gamma', '04', {})).id, // no receipt
  };
}

async function preview() {
  $('#invClient').value = clientId;
  $('#invPreviewBtn').click();
  await vi.waitFor(() => expect($('#invPreviewWrap').hidden).toBe(false), WAIT);
  await vi.waitFor(() => expect(state.invPreviewRows && state.invPreviewRows.length).toBe(4), WAIT);
}

const editBtns = () => $$('#invPreviewBody [data-edit-preview-exp]');
const editBtn = (id) => $('#invPreviewBody [data-edit-preview-exp="' + id + '"]');
const box = (id) => $('#invPreviewBody input[data-attach-receipt="' + id + '"]');
const boxIds = () => $$('#invPreviewBody input[data-attach-receipt]').map((b) => b.dataset.attachReceipt);
const tick = (b, v) => { b.checked = v; change(b); };
// Amount cell of each footer row (step 13b added an empty actions-column cell after it).
const footer = () => $$('#invTotalsFoot tr').map((tr) => tr.querySelector('td.amount').textContent);
const rowTexts = () => $$('#invPreviewBody tr').map((tr) => tr.textContent);
const toastIs = (text) => vi.waitFor(() => { expect($('#toast').hidden).toBe(false); expect($('#toast').textContent).toBe(text); }, WAIT);

// Simulates a user choosing a file in the edit-expense modal.
function pickFile(name) {
  const input = $('#editExpenseReceiptFile');
  let list = [new File(['x'], name, { type: 'image/png' })];
  Object.defineProperty(input, 'files', { configurable: true, get: () => list });
  Object.defineProperty(input, 'value', { configurable: true, get: () => (list.length ? 'fakepath/' + name : ''), set: (v) => { if (v === '') list = []; } });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function openFromPreview(id) {
  editBtn(id).click();
  await vi.waitFor(() => expect($('#editExpenseModal').hidden).toBe(false), WAIT);
  expect($('#editExpenseId').value).toBe(id);
}

// Saves the modal and waits for the preview reload to land (the rows array is replaced).
async function saveAndReload() {
  const before = state.invPreviewRows;
  $('#editExpenseSaveBtn').click();
  await vi.waitFor(() => expect($('#editExpenseModal').hidden).toBe(true), WAIT);
  await vi.waitFor(() => expect(state.invPreviewRows).not.toBe(before), WAIT);
  await vi.waitFor(() => expect($('#editExpenseSaveBtn').textContent).toBe('Save Changes'), WAIT);
}

const stored = async (id) => (await state.store.collection('expenses').doc(id).get()).data();
const invoices = async () => (await state.store.collection('invoices').get()).docs.map((d) => d.data());

async function generate() {
  const save = vi.fn(async () => {});
  state.downloads = { save };
  $('#invGenerateBtn').click();
  await vi.waitFor(() => expect($('#invPreviewWrap').hidden).toBe(true), WAIT);
  await vi.waitFor(() => expect($('#invGenerateBtn').textContent).toBe('Generate PDF Invoice'), WAIT);
  expect(save).toHaveBeenCalledTimes(1);
  return save;
}

function prevMonth(m) {
  const [y, mo] = m.split('-').map(Number);
  return mo === 1 ? (y - 1) + '-12' : y + '-' + String(mo - 1).padStart(2, '0');
}

describe('step 9: edit expenses from the invoice preview (D2)', () => {
  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    vi.resetModules();
    document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    await import('../../src/main.js');
    await vi.waitFor(() => expect($('#taxProvince').options.length).toBe(13), WAIT);
    await setup();
  });

  it('expense Edit buttons are on the expense rows, labelled with the expense title', async () => {
    await preview();
    expect(footer()).toEqual(['$95.00', '$12.35', '$107.35']);
    expect(editBtns().map((b) => b.dataset.editPreviewExp)).toEqual([ids.alpha, ids.beta, ids.gamma]);
    const timeRow = $$('#invPreviewBody tr')[0];
    expect(timeRow.textContent).toContain('Task');
    // step 13b-1 reversed "time rows have no button": the time row has an entry Edit button, never an expense one
    expect(timeRow.querySelector('[data-edit-preview-exp]')).toBeNull();
    expect(editBtn(ids.alpha).title).toBe('Edit');
    expect(editBtn(ids.alpha).getAttribute('aria-label')).toContain('Alpha');
  });

  it('edit amount + title: row, totals, stored expense and generated invoice reflect it; ticks kept', async () => {
    await preview();
    tick(box(ids.beta), false); // an unrelated tick, unticked
    tick(box(ids.alpha), false); // the edited row's own tick, unticked (receipt unchanged)
    await openFromPreview(ids.alpha);
    $('#editExpenseAmount').value = '25.25';
    $('#editExpenseTitle').value = 'Alpha Edited';
    await saveAndReload();

    expect($('#invPreviewWrap').hidden).toBe(false);
    expect(rowTexts()[1]).toContain('Alpha Edited');
    expect(rowTexts()[1]).toContain('$25.25');
    // 65 + 25.25 + 10 + 10 = 110.25; HST 13% = 14.3325 -> 14.33; total 124.58
    expect(footer()).toEqual(['$110.25', '$14.33', '$124.58']);
    expect(box(ids.alpha).checked).toBe(false);
    expect(box(ids.beta).checked).toBe(false);
    expect(state.invPreviewRows.filter((r) => r.type === 'expense').map((r) => r.attachReceipt)).toEqual([false, false, undefined]);
    expect(await stored(ids.alpha)).toMatchObject({ amount: 25.25, title: 'Alpha Edited', receiptData: PNG });

    tick(box(ids.beta), true);
    await generate();
    const list = await invoices();
    expect(list.length).toBe(1);
    const inv = list[0].invoiceDoc || list[0];
    expect(inv.totalAmount).toBe(110.25);
    expect(inv.grandTotal).toBe(124.58);
    expect(inv.lineItems.find((l) => l.description === 'Alpha Edited')).toMatchObject({ type: 'expense', amount: 25.25 });
    expect(inv.receipts.map((q) => q.title)).toEqual(['Beta']);
    expect((await stored(ids.alpha)).invoiced).toBe(true);
  });

  it('moving the date out of the month drops the row, toasts, and updates totals', async () => {
    await preview();
    tick(box(ids.beta), false);
    await openFromPreview(ids.alpha);
    $('#editExpenseDate').value = prevMonth(month) + '-15';
    await saveAndReload();
    await toastIs('Expense moved out of this invoice period.');
    expect($('#toast').className).toBe('toast');
    expect(state.invPreviewRows.length).toBe(3);
    expect(editBtn(ids.alpha)).toBeNull();
    expect(rowTexts().some((t) => t.includes('Alpha'))).toBe(false);
    expect(footer()).toEqual(['$85.00', '$11.05', '$96.05']);
    expect(box(ids.beta).checked).toBe(false);
    expect(await stored(ids.alpha)).toMatchObject({ date: prevMonth(month) + '-15' });
  });

  it('an edit that keeps the row in the month does not toast "moved out"', async () => {
    await preview();
    await openFromPreview(ids.gamma);
    $('#editExpenseDate').value = month + '-20';
    await saveAndReload();
    await flush();
    expect($('#toast').textContent).toBe('Expense updated.');
    expect(state.invPreviewRows.map((r) => r.id)).toEqual([state.invPreviewRows[0].id, ids.alpha, ids.beta, ids.gamma]);
  });

  it('remove / add / replace a receipt in the modal updates the checkboxes', async () => {
    await preview();
    expect(boxIds()).toEqual([ids.alpha, ids.beta]);

    await openFromPreview(ids.alpha);
    $('#editExpenseReceiptRemoveBtn').click();
    await saveAndReload();
    expect(boxIds()).toEqual([ids.beta]);

    await openFromPreview(ids.gamma);
    pickFile('g.png');
    await saveAndReload();
    expect(boxIds()).toEqual([ids.beta, ids.gamma]);
    expect(box(ids.gamma).checked).toBe(true);

    tick(box(ids.beta), false);
    await openFromPreview(ids.beta);
    pickFile('b.png');
    await saveAndReload();
    expect(box(ids.beta).checked).toBe(false); // a replaced receipt keeps the user's untick
    expect(box(ids.gamma).checked).toBe(true);
    expect(footer()).toEqual(['$95.00', '$12.35', '$107.35']);

    // a receipt added back to alpha (removed above, so no live prior tick) defaults to ticked
    await openFromPreview(ids.alpha);
    pickFile('a.png');
    await saveAndReload();
    expect(boxIds()).toEqual([ids.alpha, ids.beta, ids.gamma]);
    expect(box(ids.alpha).checked).toBe(true);
    expect(box(ids.beta).checked).toBe(false);
  });

  it('untick, replace the receipt in the modal: stays unticked and is not in the invoice', async () => {
    await preview();
    tick(box(ids.beta), false);
    await openFromPreview(ids.beta);
    pickFile('beta-new.png');
    await saveAndReload();
    expect(box(ids.beta).checked).toBe(false);
    expect(box(ids.alpha).checked).toBe(true);
    expect((await stored(ids.beta)).receiptData).toBe('data:image/png;base64,NEW_beta-new.png');

    await generate();
    const list = await invoices();
    expect(list.length).toBe(1);
    const inv = list[0].invoiceDoc || list[0];
    expect(inv.receipts.map((q) => q.title)).toEqual(['Alpha']);
    expect(inv.receipts.some((q) => q.dataUrl === 'data:image/png;base64,NEW_beta-new.png')).toBe(false);
  });

  it('an expense with no receipt that gets one added is ticked by default', async () => {
    await preview();
    tick(box(ids.alpha), false); // unrelated untick stays
    expect(box(ids.gamma)).toBeNull();
    await openFromPreview(ids.gamma);
    pickFile('gamma.png');
    await saveAndReload();
    expect(box(ids.gamma).checked).toBe(true);
    expect(box(ids.alpha).checked).toBe(false);
    expect(state.invPreviewRows.find((r) => r.id === ids.gamma).attachReceipt).toBe(true);
  });

  it('an edit while no preview is showing (Track tab) leaves the Invoices preview alone', async () => {
    await vi.waitFor(() => expect($('#expensesBody [data-edit-exp="' + ids.gamma + '"]')).toBeTruthy(), WAIT);
    $('#expensesBody [data-edit-exp="' + ids.gamma + '"]').click();
    expect($('#editExpenseModal').hidden).toBe(false);
    $('#editExpenseAmount').value = '12';
    $('#editExpenseSaveBtn').click();
    await vi.waitFor(() => expect($('#editExpenseModal').hidden).toBe(true), WAIT);
    await toastIs('Expense updated.');
    await flush();
    expect(state.invPreviewRows).toBeNull();
    expect(state.invPreviewMeta).toBeNull();
    expect($('#invPreviewWrap').hidden).toBe(true);
    expect((await stored(ids.gamma)).amount).toBe(12);

    // and after a preview was cleared (B3), an edit does not bring it back
    await preview();
    $('#invIncludeBilled').checked = true;
    change($('#invIncludeBilled'));
    expect($('#invPreviewWrap').hidden).toBe(true);
    $('#expensesBody [data-edit-exp="' + ids.gamma + '"]').click();
    $('#editExpenseAmount').value = '13';
    $('#editExpenseSaveBtn').click();
    await vi.waitFor(() => expect($('#editExpenseModal').hidden).toBe(true), WAIT);
    await flush();
    expect(state.invPreviewRows).toBeNull();
    expect($('#invPreviewWrap').hidden).toBe(true);
  });

  it('opens an expense that is not in the Track list window (store fallback)', async () => {
    await preview();
    state.expenses = state.expenses.filter((x) => x.id !== ids.beta);
    await openFromPreview(ids.beta);
    expect($('#editExpenseTitle').value).toBe('Beta');
    expect($('#editExpenseAmount').value).toBe('10');
    expect($('#editExpenseReceiptCurrent').hidden).toBe(false);
    $('#editExpenseAmount').value = '20';
    await saveAndReload();
    expect(footer()).toEqual(['$105.00', '$13.65', '$118.65']);
  });

  it('deleting the previewed client clears the preview', async () => {
    await preview();
    $('#clientList [data-delete="' + clientId + '"]').click();
    $('#confirmOkBtn').click();
    await vi.waitFor(() => expect(state.clients.length).toBe(0), WAIT);
    expect($('#invPreviewWrap').hidden).toBe(true);
    expect(state.invPreviewRows).toBeNull();
    expect(state.invPreviewMeta).toBeNull();
    await toastIs('Client deleted.');
  });

  it('renaming or archiving the previewed client keeps the preview', async () => {
    await preview();
    window.scrollTo = () => {}; // jsdom does not implement it; startEditClient scrolls to the form
    $('#clientList [data-edit="' + clientId + '"]').click();
    $('#clientName').value = 'Acme Renamed';
    submit($('#clientForm'));
    await vi.waitFor(() => expect(state.clients[0].name).toBe('Acme Renamed'), WAIT);
    expect($('#invPreviewWrap').hidden).toBe(false);
    expect(state.invPreviewRows.length).toBe(4);

    $('#clientList [data-archive="' + clientId + '"]').click();
    await vi.waitFor(() => expect(state.clients[0].archived).toBe(true), WAIT);
    expect($('#invPreviewWrap').hidden).toBe(false);
    expect(state.invPreviewRows.length).toBe(4);
    await flush();
  });

  it('loadInvoicePreview: keepAttach carries ticks by id; fresh resets; stale reload is a no-op', async () => {
    await preview();
    tick(box(ids.alpha), false);
    tick(box(ids.beta), false);
    await state.store.collection('expenses').doc(ids.beta).update({ receiptData: 'data:image/png;base64,REPLACED' });
    const delta = (await state.store.collection('expenses').add({ clientId, clientName: 'Acme', date: month + '-05', title: 'Delta', amount: 1, invoiced: false, ...RC })).id;

    const rows = await invoicesUi.loadInvoicePreview({ keepAttach: true });
    expect(rows).toBe(state.invPreviewRows);
    const flagsById = Object.fromEntries(rows.filter((r) => r.type === 'expense').map((r) => [r.id, r.attachReceipt]));
    // beta's receipt was replaced but its untick is kept; the new delta defaults to ticked
    expect(flagsById).toEqual({ [ids.alpha]: false, [ids.beta]: false, [ids.gamma]: undefined, [delta]: true });
    expect(box(ids.alpha).checked).toBe(false);
    expect(box(delta).checked).toBe(true);

    await invoicesUi.loadInvoicePreview();
    expect(state.invPreviewRows.filter((r) => r.attachReceipt !== undefined).every((r) => r.attachReceipt === true)).toBe(true);

    const pending = invoicesUi.loadInvoicePreview({ keepAttach: true });
    invoicesUi.clearInvoicePreview();
    expect(await pending).toBeNull();
    expect(state.invPreviewRows).toBeNull();
    expect($('#invPreviewWrap').hidden).toBe(true);
    expect(await invoicesUi.loadInvoicePreview({ keepAttach: true })).toBeNull();
  });
});
