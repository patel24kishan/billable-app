// Step 7 (B3): changing month / client / "include already invoiced" clears the
// on-screen preview. Programmatic client-list refresh must not. Driven through the real app.
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
const change = (el) => el.dispatchEvent(new Event('change', { bubbles: true }));

let state, clientId, month;

async function setup() {
  ({ state } = await import('../../src/state.js'));
  await vi.waitFor(() => expect(state.store).toBeTruthy(), WAIT); // boot is async
  for (const n of ['Acme', 'Beta']) {
    $('#clientName').value = n;
    submit($('#clientForm'));
    await vi.waitFor(() => expect(state.clients.some((c) => c.name === n)).toBe(true), WAIT);
    await vi.waitFor(() => expect($('#clientName').value).toBe(''), WAIT); // form reset after save
  }
  clientId = state.clients.find((c) => c.name === 'Acme').id;

  $('#setRate').value = '65';
  $('#taxCountry').value = 'Canada';
  change($('#taxCountry'));
  $('#taxProvince').value = 'Ontario';
  change($('#taxProvince'));
  $('#saveSettingsBtn').click();
  await vi.waitFor(() => expect(state.settings.rate).toBe(65), WAIT);

  month = $('#invMonth').value;
  for (let i = 1; i <= 2; i++) {
    await state.store.collection('entries').add({ clientId, clientName: 'Acme', date: month + '-0' + i, seconds: 3600, description: 'Task ' + i, invoiced: false });
  }
}

async function preview() {
  $('#invClient').value = clientId;
  $('#invPreviewBtn').click();
  await vi.waitFor(() => expect($('#invPreviewWrap').hidden).toBe(false), WAIT);
}

const expectCleared = () => {
  expect($('#invPreviewWrap').hidden).toBe(true);
  expect(state.invPreviewRows).toBeNull();
  expect(state.invPreviewMeta).toBeNull();
};
const invoiceCount = async () => (await state.store.collection('invoices').get()).docs.length;
const flush = () => new Promise((r) => setTimeout(r, 150));

describe('step 7: preview invalidation (B3)', () => {
  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    vi.resetModules();
    document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    await import('../../src/main.js');
    await vi.waitFor(() => expect($('#taxProvince').options.length).toBe(13), WAIT);
    await setup();
  });

  it('(a) changing the month clears the preview', async () => {
    await preview();
    $('#invMonth').value = '2020-01';
    change($('#invMonth'));
    expectCleared();
  });

  it('(b) changing the client clears the preview', async () => {
    await preview();
    $('#invClient').value = state.clients.find((c) => c.name === 'Beta').id;
    change($('#invClient'));
    expectCleared();
  });

  it('(c) toggling include-already-invoiced clears the preview', async () => {
    await preview();
    $('#invIncludeBilled').checked = true;
    change($('#invIncludeBilled'));
    expectCleared();
  });

  it('(d) Generate does nothing after clearing until Preview is clicked again', async () => {
    await preview();
    const save = vi.fn(async () => {});
    state.downloads = { save };
    $('#invMonth').value = '2020-01';
    change($('#invMonth'));
    $('#invGenerateBtn').click();
    await flush();
    expect(save).not.toHaveBeenCalled();
    expect(await invoiceCount()).toBe(0);
    expect($('#invPreviewWrap').hidden).toBe(true);

    $('#invMonth').value = month;
    change($('#invMonth'));
    await preview();
    $('#invGenerateBtn').click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1), WAIT);
    await vi.waitFor(async () => expect(await invoiceCount()).toBe(1), WAIT);
  });

  it('(e) a client-list snapshot does not clear the preview', async () => {
    await preview();
    const rows = state.invPreviewRows;
    await state.store.collection('clients').add({ name: 'Gamma', email: '', address: '', archived: false, createdAt: new Date().toISOString() });
    await vi.waitFor(() => expect(state.clients.some((c) => c.name === 'Gamma')).toBe(true), WAIT);
    await vi.waitFor(() => expect(Array.from($('#invClient').options).some((o) => o.textContent === 'Gamma')).toBe(true), WAIT);
    await flush();
    expect($('#invPreviewWrap').hidden).toBe(false);
    expect(state.invPreviewRows).toBe(rows);
    expect(state.invPreviewMeta).not.toBeNull();
    expect($('#invClient').value).toBe(clientId);
  });

  it('(f) a settings snapshot still refreshes the preview without clearing it', async () => {
    await preview();
    $('#setRate').value = '80';
    $('#saveSettingsBtn').click();
    await vi.waitFor(() => expect(state.settings.rate).toBe(80), WAIT);
    await flush();
    expect($('#invPreviewWrap').hidden).toBe(false);
    expect(state.invPreviewRows.length).toBe(2);
    expect($('#invPreviewBody').textContent).toContain('80');
  });
});
