// Step 4 (B1): the saved invoice must carry the same totals as the preview
// (per-entry rounding) and equal the sum of its own line items.
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
const num = (t) => parseFloat(t.replace(/[^0-9.\-]/g, ''));

describe('step 4: saved invoice totals match the preview (B1)', () => {
  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    vi.resetModules();
    document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    await import('../../src/main.js');
    await vi.waitFor(() => expect($('#taxProvince').options.length).toBe(13), WAIT);
  });

  it('3 entries of 1000 s at 65/h, Ontario HST: preview == saved == sum of line items', async () => {
    const { state } = await import('../../src/state.js');

    // Client through the real form.
    $('#clientName').value = 'Acme';
    submit($('#clientForm'));
    await vi.waitFor(() => expect(state.clients.length).toBe(1), WAIT);
    const clientId = state.clients[0].id;

    // Settings through the real form: rate 65, Canada / Ontario.
    $('#setRate').value = '65';
    $('#taxCountry').value = 'Canada';
    $('#taxCountry').dispatchEvent(new Event('change', { bubbles: true }));
    $('#taxProvince').value = 'Ontario';
    $('#taxProvince').dispatchEvent(new Event('change', { bubbles: true }));
    $('#saveSettingsBtn').click();
    await vi.waitFor(() => expect(state.settings.rate).toBe(65), WAIT);
    expect(state.settings.taxRegion).toBe('Ontario');

    // Three entries of 1000 s in the current billing month.
    const month = $('#invMonth').value;
    for (let i = 1; i <= 3; i++) {
      await state.store.collection('entries').add({ clientId, clientName: 'Acme', date: month + '-0' + i, seconds: 1000, description: 'Task ' + i, invoiced: false });
    }

    // Preview.
    $('#invClient').value = clientId;
    $('#invPreviewBtn').click();
    await vi.waitFor(() => expect($('#invPreviewBody').children.length).toBe(3), WAIT);
    const foot = Array.from($('#invTotalsFoot').rows).map((r) => Array.from(r.cells).map((c) => c.textContent));
    expect(num(foot[0][1])).toBe(0.84);
    expect(num(foot[0][2])).toBe(54.6);
    expect(foot[1][0]).toContain('HST');
    expect(num(foot[1][2])).toBe(7.1);
    expect(num(foot[2][2])).toBe(61.7);

    // Generate (the real jsdom-less download is stubbed; everything else is real).
    state.downloads = { save: async () => {} };
    $('#invGenerateBtn').click();
    await vi.waitFor(async () => {
      const snap = await state.store.collection('invoices').get();
      expect(snap.docs.length).toBe(1);
    }, WAIT);
    await vi.waitFor(() => expect($('#invGenerateBtn').textContent).toBe('Generate PDF Invoice'), WAIT);

    const snap = await state.store.collection('invoices').get();
    const inv = snap.docs[0].data();
    expect(inv.totalHours).toBe(0.84);
    expect(inv.totalAmount).toBe(54.6);
    expect(inv.taxLines).toEqual([{ label: 'HST', rate: 0.13, amount: 7.1 }]);
    expect(inv.taxTotal).toBe(7.1);
    expect(inv.grandTotal).toBe(61.7);
    const lineSum = Math.round(inv.lineItems.reduce((a, l) => a + l.amount, 0) * 100) / 100;
    expect(inv.totalAmount).toBe(lineSum);
    expect(inv.entryIds.length).toBe(3);

    // Saved invoice equals the preview numbers.
    expect(inv.totalHours).toBe(num(foot[0][1]));
    expect(inv.totalAmount).toBe(num(foot[0][2]));
    expect(inv.taxTotal).toBe(num(foot[1][2]));
    expect(inv.grandTotal).toBe(num(foot[2][2]));
  });
});
