// Step 15: generating an invoice in the desktop app goes through the save
// bridge. Saved -> invoice recorded; canceled dialog -> "declined", nothing
// recorded and the preview stays. Driven through the real app with the real
// downloads.js (state.downloads created by src/main.js) and a fake bridge.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(here, '../../index.html'), 'utf8');
const $ = (s) => document.querySelector(s);
const submit = (form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
const WAIT = { timeout: 4000, interval: 10 };

let state, clientId, month;

async function setup() {
  ({ state } = await import('../../src/state.js'));
  $('#clientName').value = 'Acme Studio';
  submit($('#clientForm'));
  await vi.waitFor(() => expect(state.clients.length).toBe(1), WAIT);
  clientId = state.clients[0].id;
  $('#setRate').value = '65';
  $('#saveSettingsBtn').click();
  await vi.waitFor(() => expect(state.settings.rate).toBe(65), WAIT);
  month = $('#invMonth').value;
  await state.store.collection('entries').add({ clientId, clientName: 'Acme Studio', date: month + '-01', seconds: 7200, description: 'Design', invoiced: false });
}

async function preview() {
  $('#invClient').value = clientId;
  $('#invPreviewBtn').click();
  await vi.waitFor(() => expect($('#invPreviewWrap').hidden).toBe(false), WAIT);
}

const invoiceCount = async () => (await state.store.collection('invoices').get()).docs.length;
const flush = () => new Promise((r) => setTimeout(r, 150));

describe('step 15: invoice generation through the desktop save bridge', () => {
  let saveFile;

  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    vi.resetModules();
    saveFile = vi.fn();
    window.billableDesktop = { saveFile };
    document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    await import('../../src/main.js');
    await vi.waitFor(() => expect($('#taxProvince').options.length).toBeGreaterThan(0), WAIT);
    await setup();
    await vi.waitFor(() => expect(state.downloads).toBeTruthy(), WAIT);
  });

  afterEach(() => {
    delete window.billableDesktop;
  });

  it('saved: the PDF bytes go to the bridge and the invoice is recorded', async () => {
    saveFile.mockResolvedValue({ saved: true, path: 'C:\\Users\\me\\Downloads\\Invoice.pdf' });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click');
    await preview();
    $('#invGenerateBtn').click();
    await vi.waitFor(() => expect($('#invPreviewWrap').hidden).toBe(true), WAIT);
    expect(await invoiceCount()).toBe(1);
    expect(saveFile).toHaveBeenCalledTimes(1);
    const { filename, data } = saveFile.mock.calls[0][0];
    expect(filename).toMatch(/^Invoice-0001-Acme-Studio-\d{4}-\d{2}\.pdf$/);
    expect(Object.prototype.toString.call(data)).toBe('[object ArrayBuffer]');
    expect(new TextDecoder('latin1').decode(new Uint8Array(data).subarray(0, 5))).toBe('%PDF-');
    expect(click).not.toHaveBeenCalled();
    const entries = (await state.store.collection('entries').get()).docs.map((d) => d.data());
    expect(entries.every((e) => e.invoiced)).toBe(true);
    click.mockRestore();
  });

  it('canceled: "declined" toast, nothing recorded, the preview stays for another try', async () => {
    saveFile.mockResolvedValue({ canceled: true });
    await preview();
    $('#invGenerateBtn').click();
    await vi.waitFor(() => expect($('#toast').textContent).toContain('declined'), WAIT);
    expect($('#toast').textContent).toContain('nothing was recorded');
    await vi.waitFor(() => expect($('#invGenerateBtn').disabled).toBe(false), WAIT);
    await flush();
    expect(await invoiceCount()).toBe(0);
    expect($('#invPreviewWrap').hidden).toBe(false);
    const entries = (await state.store.collection('entries').get()).docs.map((d) => d.data());
    expect(entries.every((e) => !e.invoiced)).toBe(true);

    // Second try, saved this time: exactly one invoice.
    saveFile.mockResolvedValue({ saved: true, path: 'x.pdf' });
    $('#invGenerateBtn').click();
    await vi.waitFor(() => expect($('#invPreviewWrap').hidden).toBe(true), WAIT);
    expect(await invoiceCount()).toBe(1);
  });

  it('re-download from the history uses the bridge; a cancel there shows no error', async () => {
    saveFile.mockResolvedValue({ saved: true, path: 'x.pdf' });
    await preview();
    $('#invGenerateBtn').click();
    await vi.waitFor(() => expect($('#invoicesBody').querySelector('[data-redownload]')).toBeTruthy(), WAIT);
    await vi.waitFor(() => expect($('#invGenerateBtn').disabled).toBe(false), WAIT);
    await flush();
    saveFile.mockClear();
    saveFile.mockResolvedValue({ canceled: true });
    const toastBefore = $('#toast').textContent;
    $('#invoicesBody').querySelector('[data-redownload]').click();
    await vi.waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1), WAIT);
    await flush();
    expect($('#toast').textContent).toBe(toastBefore);
    expect($('#toast').className).not.toContain('error');
  });
});
