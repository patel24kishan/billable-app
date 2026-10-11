// Step 13: the invoice history Total column uses money(amount, invoice.currency).
import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(here, '../../index.html'), 'utf8');
const $ = (s) => document.querySelector(s);
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

describe('step 13: invoice history money', () => {
  beforeEach(boot);

  it('shows grouped amounts with the invoice own currency (settings stay "$")', async () => {
    const base = { clientName: 'Acme', month: '2026-10', totalHours: 1 };
    await state.store.collection('invoices').add({ ...base, number: 1, currency: '$', totalAmount: 1000, grandTotal: 1234.5, generatedAt: '2026-10-01T10:00:00.000Z' });
    await state.store.collection('invoices').add({ ...base, number: 2, currency: '€', totalAmount: 1234567.89, generatedAt: '2026-10-02T10:00:00.000Z' });
    await vi.waitFor(() => expect($('#invoicesBody').querySelectorAll('tr').length).toBe(2), WAIT);
    const amounts = Array.from($('#invoicesBody').querySelectorAll('tr')).map((r) => r.querySelector('.amount').textContent);
    expect(amounts).toEqual(['€1,234,567.89', '$1,234.50']);
  });
});
