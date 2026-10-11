// Step 6 (M1): invoice line order is date asc, then time before expense, then
// createdAt asc, then id; a total order independent of the input order.
import { describe, it, expect } from 'vitest';
import { buildPreviewRows, compareInvoiceRows } from '../../src/services/invoices.js';

const ENTRIES = [
  { id: 'e_c', date: '2026-10-05', createdAt: '2026-10-05T09:00:00.000Z', seconds: 60 },
  { id: 'e_b', date: '2026-10-05', createdAt: '2026-10-05T10:00:00.000Z', seconds: 60 },
  { id: 'e_a', date: '2026-10-05', createdAt: '2026-10-05T11:00:00.000Z', seconds: 60 },
  { id: 'e_z', date: '2026-10-07', createdAt: '2026-10-01T00:00:00.000Z', seconds: 60 },
  { id: 'e_y', date: '2026-10-02', createdAt: '2026-10-09T00:00:00.000Z', seconds: 60 }
];
const EXPENSES = [
  // created earlier than every 10-05 entry, but must still come after them.
  { id: 'x_c', date: '2026-10-05', createdAt: '2026-10-05T01:00:00.000Z', amount: 1 },
  { id: 'x_b', date: '2026-10-05', createdAt: '2026-10-05T02:00:00.000Z', amount: 1 },
  { id: 'x_a', date: '2026-10-05', createdAt: '2026-10-05T03:00:00.000Z', amount: 1 },
  { id: 'x_d', date: '2026-10-01', createdAt: '2026-10-08T00:00:00.000Z', amount: 1 }
];
const EXPECTED = ['x_d', 'e_y', 'e_c', 'e_b', 'e_a', 'x_c', 'x_b', 'x_a', 'e_z'];

// Seeded PRNG so a failure is reproducible.
function shuffled(arr, seed) {
  const a = arr.slice();
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

describe('buildPreviewRows ordering (M1)', () => {
  it('date asc, time before expense, createdAt asc within the same date and type', () => {
    const rows = buildPreviewRows(ENTRIES, EXPENSES, true);
    expect(rows.map((r) => r.id)).toEqual(EXPECTED);
  });

  it('same-day same-type rows follow createdAt, not the input order or the id', () => {
    const rows = buildPreviewRows(ENTRIES.slice(0, 3).reverse(), [], true);
    expect(rows.map((r) => r.id)).toEqual(['e_c', 'e_b', 'e_a']);
  });

  it('time rows come before expense rows on the same date even if the expense is older', () => {
    const rows = buildPreviewRows([ENTRIES[2]], [EXPENSES[0]], true);
    expect(rows.map((r) => r.type)).toEqual(['time', 'expense']);
  });

  it('is deterministic across input permutations', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const rows = buildPreviewRows(shuffled(ENTRIES, seed), shuffled(EXPENSES, seed * 7 + 3), true);
      expect(rows.map((r) => r.id)).toEqual(EXPECTED);
    }
  });

  it('missing createdAt sorts first within its group; id is the final tiebreak', () => {
    const entries = [
      { id: 'e_2', date: '2026-10-05', createdAt: '2026-10-05T09:00:00.000Z' },
      { id: 'e_9', date: '2026-10-05' },
      { id: 'e_1', date: '2026-10-05' },
      { id: 'e_5', date: '2026-10-05', createdAt: '2026-10-05T09:00:00.000Z' }
    ];
    for (let seed = 1; seed <= 10; seed++) {
      expect(buildPreviewRows(shuffled(entries, seed), [], true).map((r) => r.id)).toEqual(['e_1', 'e_9', 'e_2', 'e_5']);
    }
  });

  it('comparator is consistent: antisymmetric, 0 only for identical keys', () => {
    const rows = buildPreviewRows(ENTRIES, EXPENSES, true);
    for (const a of rows) {
      for (const b of rows) {
        const ab = compareInvoiceRows(a, b), ba = compareInvoiceRows(b, a);
        expect(ab).toBe(-ba || 0);
        expect(ab === 0).toBe(a === b);
      }
    }
    expect(compareInvoiceRows({ type: 'time', id: 'q', date: 'd' }, { type: 'time', id: 'q', date: 'd' })).toBe(0);
  });
});
