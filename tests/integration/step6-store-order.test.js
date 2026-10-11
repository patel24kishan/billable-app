// Step 6 (C2): chained orderBy in the store. Multi-key sort in call order, each
// key with its own direction; missing fields sort as ''; the doc id is the final
// tiebreak so results never depend on IndexedDB key order.
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createStore } from '../../src/lib/store/index.js';
import { compareValues } from '../../src/domain/order.js';

const clock = () => '2026-10-10T12:00:00.000Z';
const ids = (snap) => snap.docs.map((d) => d.id);

// Ids are arranged adversarially: they sort OPPOSITE to createdAt, so any
// result that leaks IndexedDB key order (path order) shows up as a failure.
const RECORDS = [
  ['id_z9', { date: '2026-10-05', createdAt: '2026-10-05T09:00:00.000Z', n: 1 }],
  ['id_y8', { date: '2026-10-05', createdAt: '2026-10-05T10:00:00.000Z', n: 2 }],
  ['id_x7', { date: '2026-10-05', createdAt: '2026-10-05T11:00:00.000Z', n: 3 }],
  ['id_w6', { date: '2026-10-04', createdAt: '2026-10-04T08:00:00.000Z', n: 4 }],
  ['id_v5', { date: '2026-10-06', createdAt: '2026-10-06T08:00:00.000Z', n: 5 }],
  ['id_u4', { date: '2026-10-04', createdAt: '2026-10-04T12:00:00.000Z', n: 6 }]
];

async function seed(store, order = RECORDS) {
  for (const [id, data] of order) await store.collection('entries').doc(id).set(data);
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('store: chained orderBy (C2)', () => {
  it('date desc then createdAt desc: newest first within a day', async () => {
    const store = await createStore({ now: clock });
    await seed(store);
    const snap = await store.collection('entries').orderBy('date', 'desc').orderBy('createdAt', 'desc').get();
    expect(ids(snap)).toEqual(['id_v5', 'id_x7', 'id_y8', 'id_z9', 'id_u4', 'id_w6']);
  });

  it('date desc then createdAt asc (mixed directions)', async () => {
    const store = await createStore({ now: clock });
    await seed(store);
    const snap = await store.collection('entries').orderBy('date', 'desc').orderBy('createdAt', 'asc').get();
    expect(ids(snap)).toEqual(['id_v5', 'id_z9', 'id_y8', 'id_x7', 'id_w6', 'id_u4']);
  });

  it('date asc then createdAt desc (mixed directions)', async () => {
    const store = await createStore({ now: clock });
    await seed(store);
    const snap = await store.collection('entries').orderBy('date').orderBy('createdAt', 'desc').get();
    expect(ids(snap)).toEqual(['id_u4', 'id_w6', 'id_x7', 'id_y8', 'id_z9', 'id_v5']);
  });

  it('the second key only breaks ties of the first', async () => {
    const store = await createStore({ now: clock });
    await seed(store);
    // n desc would put 6 first; date asc must still win.
    const snap = await store.collection('entries').orderBy('date').orderBy('n', 'desc').get();
    expect(snap.docs.map((d) => d.data().n)).toEqual([6, 4, 3, 2, 1, 5]);
  });

  it('three keys chain in call order', async () => {
    const store = await createStore({ now: clock });
    for (const [id, data] of [
      ['id_a', { g: 1, h: 'x', n: 1 }], ['id_b', { g: 1, h: 'x', n: 2 }],
      ['id_c', { g: 1, h: 'y', n: 3 }], ['id_d', { g: 0, h: 'y', n: 4 }]
    ]) await store.collection('t').doc(id).set(data);
    const snap = await store.collection('t').orderBy('g', 'desc').orderBy('h').orderBy('n', 'desc').get();
    expect(ids(snap)).toEqual(['id_b', 'id_a', 'id_c', 'id_d']);
  });

  it('limit is applied after the full ordering', async () => {
    const store = await createStore({ now: clock });
    await seed(store);
    const q = store.collection('entries').orderBy('date', 'desc').orderBy('createdAt', 'desc');
    expect(ids(await q.limit(3).get())).toEqual(['id_v5', 'id_x7', 'id_y8']);
    // limit before orderBy in the chain is the same query
    expect(ids(await store.collection('entries').limit(3).orderBy('date', 'desc').orderBy('createdAt', 'desc').get()))
      .toEqual(['id_v5', 'id_x7', 'id_y8']);
  });

  it('where + chained orderBy + limit, also via onSnapshot', async () => {
    const store = await createStore({ now: clock });
    await seed(store);
    const seen = [];
    const unsub = store.collection('entries').where('date', '<=', '2026-10-05')
      .orderBy('date', 'desc').orderBy('createdAt', 'desc').limit(4)
      .onSnapshot((snap) => seen.push(ids(snap)));
    expect(seen.at(-1)).toEqual(['id_x7', 'id_y8', 'id_z9', 'id_u4']);
    await store.collection('entries').doc('id_a0').set({ date: '2026-10-05', createdAt: '2026-10-05T23:00:00.000Z' });
    expect(seen.at(-1)).toEqual(['id_a0', 'id_x7', 'id_y8', 'id_z9']);
    unsub();
  });

  it('missing fields sort as empty string; the id is the final tiebreak (direction of the last orderBy)', async () => {
    const store = await createStore({ now: clock });
    // Legacy records without createdAt (set() does not fill it), same date.
    for (const [id, data] of [
      ['id_m', { date: '2026-10-05' }],
      ['id_q', { date: '2026-10-05', createdAt: '2026-10-05T10:00:00.000Z' }],
      ['id_b', { date: '2026-10-05' }],
      ['id_k', { date: '2026-10-05', createdAt: null }],
      ['id_r', { createdAt: '2026-10-01T00:00:00.000Z' }]
    ]) await store.collection('entries').doc(id).set(data);
    const desc = await store.collection('entries').orderBy('date', 'desc').orderBy('createdAt', 'desc').get();
    expect(ids(desc)).toEqual(['id_q', 'id_m', 'id_k', 'id_b', 'id_r']);
    const asc = await store.collection('entries').orderBy('date').orderBy('createdAt').get();
    expect(ids(asc)).toEqual(['id_r', 'id_b', 'id_k', 'id_m', 'id_q']);
  });

  it('result is identical across reloads and insertion orders (never IndexedDB key order)', async () => {
    const q = (s) => s.collection('entries').orderBy('date', 'desc').orderBy('createdAt', 'desc').get();
    const expected = ['id_v5', 'id_x7', 'id_y8', 'id_z9', 'id_u4', 'id_w6'];
    const orders = [RECORDS, RECORDS.slice().reverse(), [2, 5, 0, 4, 1, 3].map((i) => RECORDS[i])];
    for (const order of orders) {
      globalThis.indexedDB = new IDBFactory();
      const s1 = await createStore({ now: clock });
      await seed(s1, order);
      expect(ids(await q(s1))).toEqual(expected);
      for (let i = 0; i < 3; i++) {
        const s2 = await createStore({ now: clock }); // simulated reload on the same IndexedDB
        expect(ids(await q(s2))).toEqual(expected);
      }
    }
  });

  it('a single orderBy and unordered queries behave as before', async () => {
    const store = await createStore({ now: clock });
    await seed(store);
    expect((await store.collection('entries').orderBy('n', 'desc').get()).docs.map((d) => d.data().n)).toEqual([6, 5, 4, 3, 2, 1]);
    expect((await store.collection('entries').where('date', '==', '2026-10-04').get()).docs.length).toBe(2);
    expect((await store.collection('entries').limit(2).get()).docs.length).toBe(2);
  });
});

describe('domain/order compareValues', () => {
  it('missing values equal the empty string and sort first', () => {
    expect(compareValues(undefined, '')).toBe(0);
    expect(compareValues(null, undefined)).toBe(0);
    expect(compareValues(undefined, 'a')).toBe(-1);
    expect(compareValues('a', null)).toBe(1);
  });
  it('is consistent across mixed types', () => {
    expect(compareValues(1, 'a')).toBe(-compareValues('a', 1));
    expect(compareValues(2, 10)).toBe(-1);
    expect(compareValues('2', '10')).toBe(1);
  });
});
