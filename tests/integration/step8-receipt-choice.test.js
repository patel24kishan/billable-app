// Step 8 (D1): per-expense "attach receipt" choice in the invoice preview. Driven through the real app.
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
const change = (el) => el.dispatchEvent(new Event('change', { bubbles: true }));
const flush = () => new Promise((r) => setTimeout(r, 150));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

let state, clientId, month;

async function setup() {
  ({ state } = await import('../../src/state.js'));
  await vi.waitFor(() => expect(state.store).toBeTruthy(), WAIT);
  $('#clientName').value = 'Acme';
  submit($('#clientForm'));
  await vi.waitFor(() => expect(state.clients.some((c) => c.name === 'Acme')).toBe(true), WAIT);
  clientId = state.clients[0].id;
  $('#setRate').value = '65';
  $('#saveSettingsBtn').click();
  await vi.waitFor(() => expect(state.settings.rate).toBe(65), WAIT);
  month = $('#invMonth').value;
  await state.store.collection('entries').add({ clientId, clientName: 'Acme', date: month + '-01', seconds: 3600, description: 'Task', invoiced: false });
  const rc = { receiptData: PNG, receiptType: 'image/png', receiptW: 1, receiptH: 1 };
  const ex = (title, day, extra) => state.store.collection('expenses').add(Object.assign({ clientId, clientName: 'Acme', date: month + '-' + day, title, amount: 10, invoiced: false }, extra));
  await ex('Alpha', '02', rc);
  await ex('Beta', '03', rc);
  await ex('Gamma', '04', {}); // no receipt
}

async function preview() {
  $('#invClient').value = clientId;
  $('#invPreviewBtn').click();
  await vi.waitFor(() => expect($('#invPreviewWrap').hidden).toBe(false), WAIT);
}
const boxes = () => $$('#invPreviewBody input[data-attach-receipt]');
const flags = () => boxes().map((b) => b.checked);
const tick = (b, v) => { b.checked = v; change(b); };
const totalText = () => $('#invTotalsFoot').textContent;
const pageCount = async (save) => {
  const blob = save.mock.calls[0][0].data;
  const pdf = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsBinaryString(blob); });
  return (pdf.match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
};
const invoices = async () => (await state.store.collection('invoices').get()).docs.map((d) => d.data());
const receiptTitles = (inv) => (inv.invoiceDoc || inv).receipts.map((q) => q.title);

async function generate() {
  const save = vi.fn(async () => {});
  state.downloads = { save };
  $('#invGenerateBtn').click();
  await vi.waitFor(() => expect($('#invPreviewWrap').hidden).toBe(true), WAIT);
  await vi.waitFor(() => expect($('#invGenerateBtn').textContent).toBe('Generate PDF Invoice'), WAIT);
  expect(save).toHaveBeenCalledTimes(1);
  return save;
}

describe('step 8: receipt choice in preview (D1)', () => {
  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    vi.resetModules();
    document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    await import('../../src/main.js');
    await vi.waitFor(() => expect($('#taxProvince').options.length).toBe(13), WAIT);
    await setup();
  });

  it('checkboxes only for receipt expenses, default ticked, control visible', async () => {
    await preview();
    expect($('#invPreviewBody').children.length).toBe(4);
    expect(boxes().length).toBe(2);
    expect(flags()).toEqual([true, true]);
    expect($('#invReceiptChoice').hidden).toBe(false);
  });

  it('control hidden when no previewed expense has a receipt', async () => {
    for (const d of (await state.store.collection('expenses').get()).docs) {
      if (d.data().receiptData) await state.store.collection('expenses').doc(d.id).update({ receiptData: null });
    }
    await preview();
    expect(boxes().length).toBe(0);
    expect($('#invReceiptChoice').hidden).toBe(true);
  });

  it('toggle, re-render keeps ticks, attach all / none, no clearing', async () => {
    await preview();
    const before = totalText();
    tick(boxes()[0], false);
    expect(flags()).toEqual([false, true]);
    expect($('#invPreviewWrap').hidden).toBe(false);

    // a settings save re-renders the preview; ticks survive
    $('#saveSettingsBtn').click();
    await flush();
    expect($('#invPreviewWrap').hidden).toBe(false);
    expect(flags()).toEqual([false, true]);

    $('#invAttachNoneBtn').click();
    expect(flags()).toEqual([false, false]);
    expect(totalText()).toBe(before);
    $('#invAttachAllBtn').click();
    expect(flags()).toEqual([true, true]);
  });

  it('Generate stores only ticked receipts; totals unchanged; re-preview resets', async () => {
    await preview();
    const allTotal = totalText();
    tick(boxes()[0], false);
    expect(totalText()).toBe(allTotal);
    const save = await generate();
    expect(await pageCount(save)).toBe(2);
    let list = await invoices();
    expect(list.length).toBe(1);
    expect(receiptTitles(list[0])).toEqual(['Beta']);

    // rebuild (include already-invoiced rows): choices are reset to all ticked
    $('#invIncludeBilled').checked = true;
    await preview();
    expect(flags()).toEqual([true, true]);
    expect(totalText()).toBe(allTotal);
    $('#invAttachNoneBtn').click();
    expect(totalText()).toBe(allTotal);
    const save2 = await generate();
    expect(await pageCount(save2)).toBe(1);
    list = await invoices();
    expect(list.length).toBe(2);
    expect(list.map(receiptTitles).sort()).toEqual([[], ['Beta']]);
    const g = (i) => (i.invoiceDoc || i).grandTotal;
    expect(g(list[0])).toBe(g(list[1]));
  });
});
