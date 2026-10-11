import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { hasReceipt, getReceipt, receiptFields, clearedReceiptFields, createReceipts, fileToCompressedDataUrl } from '../../src/lib/receipts.js';
import { createStore } from '../../src/lib/store/index.js';

const withReceipt = { id: 'x1', title: 'Paper', receiptData: 'data:image/png;base64,AAAA', receiptType: 'image/png', receiptW: 10, receiptH: 20 };
const noReceipt = { id: 'x2', title: 'Ink' };
const rawReceipt = { id: 'x3', title: 'Old', receiptData: 'data:image/jpeg;base64,BBBB' }; // no type/size stored

describe('receipt accessors', () => {
  it('hasReceipt', () => {
    expect(hasReceipt(withReceipt)).toBe(true);
    expect(hasReceipt(noReceipt)).toBe(false);
    expect(hasReceipt({ receiptData: null })).toBe(false);
    expect(hasReceipt({ receiptData: '' })).toBe(false);
  });

  it('getReceipt returns raw stored values with no defaults, or null', () => {
    expect(getReceipt(withReceipt)).toEqual({ dataUrl: withReceipt.receiptData, type: 'image/png', width: 10, height: 20 });
    expect(getReceipt(rawReceipt)).toEqual({ dataUrl: rawReceipt.receiptData, type: undefined, width: undefined, height: undefined });
    expect(getReceipt(noReceipt)).toBe(null);
  });

  it('receiptFields / clearedReceiptFields shapes', () => {
    expect(receiptFields({ dataUrl: 'd', type: 'image/jpeg', width: 3, height: 4 }))
      .toEqual({ receiptData: 'd', receiptType: 'image/jpeg', receiptW: 3, receiptH: 4 });
    expect(clearedReceiptFields()).toEqual({ receiptData: null, receiptType: null, receiptW: null, receiptH: null });
    expect(clearedReceiptFields()).not.toBe(clearedReceiptFields());
  });
});

describe('createReceipts', () => {
  beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });

  it('put and remove update the expense record', async () => {
    const store = await createStore();
    const ref = await store.collection('expenses').add({ title: 'Paper', amount: 5 });
    const receipts = createReceipts(store);
    expect(receipts.has).toBe(hasReceipt);
    expect(receipts.get).toBe(getReceipt);

    await receipts.put(ref.id, { dataUrl: 'data:image/png;base64,QQ', type: 'image/png', width: 1, height: 2 });
    let d = (await store.collection('expenses').doc(ref.id).get()).data();
    expect(d).toMatchObject({ title: 'Paper', amount: 5, receiptData: 'data:image/png;base64,QQ', receiptType: 'image/png', receiptW: 1, receiptH: 2 });
    expect(receipts.has(d)).toBe(true);

    await receipts.remove(ref.id);
    d = (await store.collection('expenses').doc(ref.id).get()).data();
    expect(d).toMatchObject({ title: 'Paper', amount: 5, receiptData: null, receiptType: null, receiptW: null, receiptH: null });
    expect(receipts.has(d)).toBe(false);
  });
});

describe('fileToCompressedDataUrl', () => {
  it('rejects a non-image file', async () => {
    const file = new File(['hello'], 'note.txt', { type: 'text/plain' });
    await expect(fileToCompressedDataUrl(file)).rejects.toThrow('Please choose a JPEG or PNG image.');
  });
});
