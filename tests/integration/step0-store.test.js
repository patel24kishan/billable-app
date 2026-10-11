// Step 0: the store seam (lib/store) with updatedAt stamping, and recordInvoice.
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createStore } from '../../src/lib/store/index.js';
import { IDLE_TIMER } from '../../src/domain/timer.js';
import { recordInvoice } from '../../src/services/invoices.js';

const T1 = '2026-10-10T12:00:00.000Z';
const T2 = '2026-10-10T13:00:00.000Z';
const T3 = '2026-10-10T14:00:00.000Z';

let T;
const clock = () => T;
const docData = async (ref) => { const s = await ref.get(); return s.exists ? s.data() : undefined; };

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  T = T1;
});

describe('store: add', () => {
  it('returns an id_ id, keeps the caller createdAt, stamps updatedAt', async () => {
    const store = await createStore({ now: clock });
    const ref = await store.collection('clients').add({ name: 'Acme', createdAt: '2020-01-01T00:00:00.000Z' });
    expect(ref.id).toMatch(/^id_/);
    const d = await docData(store.collection('clients').doc(ref.id));
    expect(d).toEqual({ name: 'Acme', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: T1 });
  });

  it('fills createdAt when missing and never mutates the input', async () => {
    const store = await createStore({ now: clock });
    const input = { name: 'Beta' };
    const ref = await store.collection('clients').add(input);
    expect(input).toEqual({ name: 'Beta' });
    const d = await docData(store.collection('clients').doc(ref.id));
    expect(d.createdAt).toBe(T1);
    expect(d.updatedAt).toBe(T1);
  });

  it('defaults the clock to the real time', async () => {
    const store = await createStore();
    const ref = await store.collection('clients').add({ name: 'C' });
    const d = await docData(store.collection('clients').doc(ref.id));
    expect(d.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(d.createdAt).toBe(d.updatedAt);
  });
});

describe('store: update / set / delete / remove', () => {
  it('update merges fields, keeps createdAt, bumps updatedAt', async () => {
    const store = await createStore({ now: clock });
    const ref = await store.collection('entries').add({ seconds: 60, description: 'a' });
    T = T2;
    const patch = { seconds: 120 };
    await store.collection('entries').doc(ref.id).update(patch);
    expect(patch).toEqual({ seconds: 120 });
    const d = await docData(store.collection('entries').doc(ref.id));
    expect(d).toEqual({ seconds: 120, description: 'a', createdAt: T1, updatedAt: T2 });
  });

  it('update on a missing doc creates it with updatedAt', async () => {
    const store = await createStore({ now: clock });
    await store.doc('settings/main').update({ nextInvoiceNumber: 5 });
    expect(await docData(store.doc('settings/main'))).toEqual({ nextInvoiceNumber: 5, updatedAt: T1 });
  });

  it('set replaces the doc, stamps updatedAt, overrides a caller updatedAt', async () => {
    const store = await createStore({ now: clock });
    await store.doc('state/timer').set({ status: 'running', clientId: 'x' });
    T = T2;
    await store.doc('state/timer').set({ status: 'paused', updatedAt: '1999-01-01T00:00:00.000Z' });
    expect(await docData(store.doc('state/timer'))).toEqual({ status: 'paused', updatedAt: T2 });
  });

  it('set works with a frozen input and leaves it untouched', async () => {
    const store = await createStore({ now: clock });
    expect(Object.isFrozen(IDLE_TIMER)).toBe(true);
    const before = { ...IDLE_TIMER };
    await store.doc('state/timer').set(IDLE_TIMER);
    expect({ ...IDLE_TIMER }).toEqual(before);
    expect('updatedAt' in IDLE_TIMER).toBe(false);
    expect(await docData(store.doc('state/timer'))).toEqual({ ...before, updatedAt: T1 });
  });

  it('delete() and remove() both remove the doc', async () => {
    const store = await createStore({ now: clock });
    const a = await store.collection('expenses').add({ title: 'a' });
    const b = await store.collection('expenses').add({ title: 'b' });
    await store.collection('expenses').doc(a.id).delete();
    await store.collection('expenses').doc(b.id).remove();
    expect((await store.collection('expenses').doc(a.id).get()).exists).toBe(false);
    expect((await store.collection('expenses').doc(b.id).get()).exists).toBe(false);
    expect((await store.collection('expenses').get()).docs).toEqual([]);
  });
});

describe('store: persistence', () => {
  it('a second store on the same IndexedDB sees writes, stamps and deletions', async () => {
    const s1 = await createStore({ now: clock });
    const keep = await s1.collection('clients').add({ name: 'Keep' });
    const gone = await s1.collection('clients').add({ name: 'Gone' });
    await s1.collection('clients').doc(gone.id).remove();
    T = T2;
    await s1.doc('settings/main').set({ rate: 65 });

    const s2 = await createStore({ now: clock });
    const docs = (await s2.collection('clients').get()).docs;
    expect(docs.map((d) => d.id)).toEqual([keep.id]);
    expect(docs[0].data()).toEqual({ name: 'Keep', createdAt: T1, updatedAt: T1 });
    expect(await docData(s2.doc('settings/main'))).toEqual({ rate: 65, updatedAt: T2 });
  });
});

describe('store: queries', () => {
  async function seed(store) {
    await store.collection('entries').add({ clientId: 'a', date: '2026-09-30', n: 1 });
    await store.collection('entries').add({ clientId: 'a', date: '2026-10-01', n: 2 });
    await store.collection('entries').add({ clientId: 'a', date: '2026-10-31', n: 3 });
    await store.collection('entries').add({ clientId: 'b', date: '2026-10-15', n: 4 });
    await store.collection('entries').add({ clientId: 'a', date: '2026-11-01', n: 5 });
  }
  const ns = (snap) => snap.docs.map((d) => d.data().n);

  it('where ==, >=, <= chained', async () => {
    const store = await createStore({ now: clock });
    await seed(store);
    const snap = await store.collection('entries').where('clientId', '==', 'a').where('date', '>=', '2026-10-01').where('date', '<=', '2026-10-31').get();
    expect(ns(snap).sort()).toEqual([2, 3]);
  });

  it('orderBy asc / desc and limit', async () => {
    const store = await createStore({ now: clock });
    await seed(store);
    expect(ns(await store.collection('entries').orderBy('date').get())).toEqual([1, 2, 4, 3, 5]);
    expect(ns(await store.collection('entries').orderBy('date', 'desc').get())).toEqual([5, 3, 4, 2, 1]);
    expect(ns(await store.collection('entries').orderBy('date', 'desc').limit(2).get())).toEqual([5, 3]);
    expect((await store.collection('entries').limit(3).get()).docs.length).toBe(3);
  });

  it('orderBy is single: a second orderBy replaces the first', async () => {
    const store = await createStore({ now: clock });
    await seed(store);
    expect(ns(await store.collection('entries').orderBy('date').orderBy('n', 'desc').get())).toEqual([5, 4, 3, 2, 1]);
  });

  it('collection get returns every doc with ids', async () => {
    const store = await createStore({ now: clock });
    await seed(store);
    const snap = await store.collection('entries').get();
    expect(snap.docs.length).toBe(5);
    snap.docs.forEach((d) => expect(d.id).toMatch(/^id_/));
  });
});

describe('store: onSnapshot', () => {
  it('collection listener fires now, after add/update/remove, and stops after unsubscribe', async () => {
    const store = await createStore({ now: clock });
    const seen = [];
    const unsub = store.collection('clients').onSnapshot((snap) => seen.push(snap.docs.map((d) => d.data().name)));
    expect(seen).toEqual([[]]);
    const ref = await store.collection('clients').add({ name: 'A' });
    expect(seen.at(-1)).toEqual(['A']);
    await store.collection('clients').doc(ref.id).update({ name: 'B' });
    expect(seen.at(-1)).toEqual(['B']);
    await store.collection('clients').doc(ref.id).remove();
    expect(seen.at(-1)).toEqual([]);
    const count = seen.length;
    unsub();
    await store.collection('clients').add({ name: 'C' });
    expect(seen.length).toBe(count);
  });

  it('query listener applies where/orderBy/limit on every fire', async () => {
    const store = await createStore({ now: clock });
    const seen = [];
    const unsub = store.collection('entries').where('clientId', '==', 'a').orderBy('date', 'desc').limit(2)
      .onSnapshot((snap) => seen.push(snap.docs.map((d) => d.data().date)));
    expect(seen).toEqual([[]]);
    await store.collection('entries').add({ clientId: 'a', date: '2026-10-01' });
    await store.collection('entries').add({ clientId: 'b', date: '2026-10-05' });
    await store.collection('entries').add({ clientId: 'a', date: '2026-10-03' });
    const r = await store.collection('entries').add({ clientId: 'a', date: '2026-10-02' });
    expect(seen.at(-1)).toEqual(['2026-10-03', '2026-10-02']);
    await store.collection('entries').doc(r.id).update({ date: '2026-10-09' });
    expect(seen.at(-1)).toEqual(['2026-10-09', '2026-10-03']);
    await store.collection('entries').doc(r.id).remove();
    expect(seen.at(-1)).toEqual(['2026-10-03', '2026-10-01']);
    const count = seen.length;
    unsub();
    await store.collection('entries').add({ clientId: 'a', date: '2026-10-20' });
    expect(seen.length).toBe(count);
  });

  it('doc listener fires now, after set/update/remove, and stops after unsubscribe', async () => {
    const store = await createStore({ now: clock });
    const seen = [];
    const unsub = store.doc('settings/main').onSnapshot((snap) => seen.push(snap.exists ? snap.data().rate : null));
    expect(seen).toEqual([null]);
    await store.doc('settings/main').set({ rate: 50 });
    expect(seen.at(-1)).toBe(50);
    await store.doc('settings/main').update({ rate: 65 });
    expect(seen.at(-1)).toBe(65);
    await store.doc('settings/main').remove();
    expect(seen.at(-1)).toBe(null);
    const count = seen.length;
    unsub();
    await store.doc('settings/main').set({ rate: 1 });
    expect(seen.length).toBe(count);
  });

  it("doc('settings/main') and collection('settings').doc('main') are the same record", async () => {
    const store = await createStore({ now: clock });
    await store.doc('settings/main').set({ rate: 70 });
    expect((await docData(store.collection('settings').doc('main'))).rate).toBe(70);
    await store.collection('settings').doc('main').update({ rate: 80 });
    expect((await docData(store.doc('settings/main'))).rate).toBe(80);
  });
});

describe('services/invoices recordInvoice', () => {
  it('adds the invoice, marks entries/expenses invoiced, bumps nextInvoiceNumber', async () => {
    const store = await createStore({ now: clock });
    await store.doc('settings/main').set({ nextInvoiceNumber: 7, rate: 65 });
    const e1 = await store.collection('entries').add({ seconds: 3600, invoiced: false });
    const e2 = await store.collection('entries').add({ seconds: 1800, invoiced: false });
    const x1 = await store.collection('expenses').add({ amount: 10, invoiced: false });
    const other = await store.collection('entries').add({ seconds: 60, invoiced: false });
    T = T2;
    const invoiceDoc = { number: 7, month: '2026-10', generatedAt: T2, totalAmount: 100 };
    await recordInvoice(store, { invoiceDoc, entryIds: [e1.id, e2.id], expenseIds: [x1.id], clientId: 'c1', clientName: 'Acme' });

    const invs = (await store.collection('invoices').get()).docs;
    expect(invs.length).toBe(1);
    const inv = invs[0];
    expect(inv.data()).toEqual({
      ...invoiceDoc, entryIds: [e1.id, e2.id], expenseIds: [x1.id], clientId: 'c1', clientName: 'Acme',
      createdAt: T2, updatedAt: T2
    });
    expect(invoiceDoc).toEqual({ number: 7, month: '2026-10', generatedAt: T2, totalAmount: 100 });
    for (const [col, id] of [['entries', e1.id], ['entries', e2.id], ['expenses', x1.id]]) {
      const d = await docData(store.collection(col).doc(id));
      expect(d.invoiced).toBe(true);
      expect(d.invoiceId).toBe(inv.id);
      expect(d.updatedAt).toBe(T2);
    }
    expect((await docData(store.collection('entries').doc(other.id))).invoiced).toBe(false);
    const settings = await docData(store.doc('settings/main'));
    expect(settings.nextInvoiceNumber).toBe(8);
    expect(settings.rate).toBe(65);
  });
});
