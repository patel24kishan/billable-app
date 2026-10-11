// Step 5 (B2): after a successful generate the preview is cleared so a second
// click cannot create a duplicate invoice. Declined/failed saves keep it.
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

let state, clientId, month;

async function setup() {
  ({ state } = await import('../../src/state.js'));
  $('#clientName').value = 'Acme';
  submit($('#clientForm'));
  await vi.waitFor(() => expect(state.clients.length).toBe(1), WAIT);
  clientId = state.clients[0].id;

  $('#setRate').value = '65';
  $('#taxCountry').value = 'Canada';
  $('#taxCountry').dispatchEvent(new Event('change', { bubbles: true }));
  $('#taxProvince').value = 'Ontario';
  $('#taxProvince').dispatchEvent(new Event('change', { bubbles: true }));
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

const invoiceCount = async () => (await state.store.collection('invoices').get()).docs.length;
const flush = () => new Promise((r) => setTimeout(r, 150));

describe('step 5: preview cleared after generate (B2)', () => {
  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    vi.resetModules();
    document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    await import('../../src/main.js');
    await vi.waitFor(() => expect($('#taxProvince').options.length).toBe(13), WAIT);
    await setup();
  });

  it('success clears the preview; a second Generate makes no duplicate; re-preview excludes invoiced rows', async () => {
    await preview();
    expect($('#invPreviewBody').children.length).toBe(2);
    const save = vi.fn(async () => {});
    state.downloads = { save };
    $('#invGenerateBtn').click();
    await vi.waitFor(() => expect($('#invPreviewWrap').hidden).toBe(true), WAIT);
    expect(state.invPreviewRows).toBeNull();
    expect(state.invPreviewMeta).toBeNull();
    await vi.waitFor(() => expect($('#invGenerateBtn').textContent).toBe('Generate PDF Invoice'), WAIT);
    await flush(); // let the settings/entries snapshots settle: no stale re-render
    expect($('#invPreviewWrap').hidden).toBe(true);
    expect(await invoiceCount()).toBe(1);

    // Second click: nothing happens, no crash, no duplicate.
    $('#invGenerateBtn').click();
    await flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(await invoiceCount()).toBe(1);

    // Re-preview: invoiced rows are excluded.
    await preview();
    expect($('#invPreviewBody').children.length).toBe(0);
    expect($('#invPreviewEmpty').hidden).toBe(false);

    // Unless "include already invoiced" is ticked.
    $('#invIncludeBilled').checked = true;
    $('#invPreviewBtn').click();
    await vi.waitFor(() => expect($('#invPreviewBody').children.length).toBe(2), WAIT);
  });

  it('declined download keeps the preview and records nothing', async () => {
    await preview();
    state.downloads = { save: async () => { throw Object.assign(new Error('no'), { code: 'declined' }); } };
    $('#invGenerateBtn').click();
    await vi.waitFor(() => expect($('#toast').textContent).toContain('declined'), WAIT);
    await vi.waitFor(() => expect($('#invGenerateBtn').textContent).toBe('Generate PDF Invoice'), WAIT);
    await flush();
    expect($('#invPreviewWrap').hidden).toBe(false);
    expect(state.invPreviewRows.length).toBe(2);
    expect(state.invPreviewMeta).not.toBeNull();
    expect(await invoiceCount()).toBe(0);
  });

  it('generic save failure keeps the preview and records nothing', async () => {
    await preview();
    state.downloads = { save: async () => { throw new Error('disk full'); } };
    $('#invGenerateBtn').click();
    await vi.waitFor(() => expect($('#toast').textContent).toContain('disk full'), WAIT);
    await vi.waitFor(() => expect($('#invGenerateBtn').textContent).toBe('Generate PDF Invoice'), WAIT);
    await flush();
    expect($('#invPreviewWrap').hidden).toBe(false);
    expect(state.invPreviewRows.length).toBe(2);
    expect(await invoiceCount()).toBe(0);
  });
});
