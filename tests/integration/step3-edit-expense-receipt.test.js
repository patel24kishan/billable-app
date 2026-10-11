// Step 3 (C7 + M2): in the edit-expense modal, Remove must discard a newly
// picked receipt file, and a picked file must be un-pickable when the expense
// had no stored receipt. Driven through the real app (index.html + src/main.js).
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
    fileToCompressedDataUrl: async (file) => ({ dataUrl: 'data:image/png;base64,NEW_' + file.name, type: 'image/png', width: 10, height: 20 }),
  };
});

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(here, '../../index.html'), 'utf8');
const $ = (s) => document.querySelector(s);
const WAIT = { timeout: 4000, interval: 10 };
const OLD = { receiptData: 'data:image/jpeg;base64,OLD', receiptType: 'image/jpeg', receiptW: 5, receiptH: 6 };
const NONE = { receiptData: null, receiptType: null, receiptW: null, receiptH: null };

async function storedExpense(id) {
  const { state } = await import('../../src/state.js');
  const snap = await state.store.collection('expenses').doc(id).get();
  return snap.data();
}

// Simulates a user choosing a file: the input's files list and value behave like a real file input.
function pickFile(name) {
  const input = $('#editExpenseReceiptFile');
  let list = [new File(['x'], name, { type: 'image/png' })];
  Object.defineProperty(input, 'files', { configurable: true, get: () => list });
  Object.defineProperty(input, 'value', { configurable: true, get: () => (list.length ? 'fakepath/' + name : ''), set: (v) => { if (v === '') list = []; } });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function openEdit(withReceipt) {
  const { state } = await import('../../src/state.js');
  const ref = await state.store.collection('expenses').add({ date: '2026-10-01', amount: 12.5, title: 'Lunch', ...(withReceipt ? OLD : NONE) });
  const id = ref.id;
  await vi.waitFor(() => expect($('#expensesBody [data-edit-exp="' + id + '"]')).toBeTruthy(), WAIT);
  $('#expensesBody [data-edit-exp="' + id + '"]').click();
  expect($('#editExpenseModal').hidden).toBe(false);
  return id;
}

async function save(id) {
  $('#editExpenseSaveBtn').click();
  await vi.waitFor(() => expect($('#editExpenseModal').hidden).toBe(true), WAIT);
  return storedExpense(id);
}

describe('step 3: edit-expense receipt Remove / clear', () => {
  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    vi.resetModules();
    document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    await import('../../src/main.js');
    await vi.waitFor(() => expect($('#taxProvince').options.length).toBe(13), WAIT);
  });

  it('(a) stored receipt: pick new file, Remove, Save -> receipt fully cleared', async () => {
    const id = await openEdit(true);
    pickFile('new.png');
    $('#editExpenseReceiptRemoveBtn').click();
    expect($('#editExpenseReceiptFile').files.length).toBe(0);
    const e = await save(id);
    expect(e).toMatchObject(NONE);
  });

  it('(b) stored receipt: pick new file, Save -> replaced', async () => {
    const id = await openEdit(true);
    pickFile('new.png');
    const e = await save(id);
    expect(e).toMatchObject({ receiptData: 'data:image/png;base64,NEW_new.png', receiptType: 'image/png', receiptW: 10, receiptH: 20 });
  });

  it('(c) stored receipt: Remove, Save -> cleared', async () => {
    const id = await openEdit(true);
    $('#editExpenseReceiptRemoveBtn').click();
    const e = await save(id);
    expect(e).toMatchObject(NONE);
  });

  it('(d) no stored receipt: pick a file, clear it via the revealed control, Save -> still none', async () => {
    const id = await openEdit(false);
    expect($('#editExpenseReceiptCurrent').hidden).toBe(true);
    pickFile('new.png');
    expect($('#editExpenseReceiptCurrent').hidden).toBe(false);
    expect($('#editExpenseReceiptRemoveBtn').textContent).toBe('Clear selected file');
    $('#editExpenseReceiptRemoveBtn').click();
    expect($('#editExpenseReceiptCurrent').hidden).toBe(true);
    expect($('#editExpenseReceiptFile').files.length).toBe(0);
    const e = await save(id);
    expect(e).toMatchObject(NONE);
  });
});
