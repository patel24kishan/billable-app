import { describe, it, expect } from 'vitest';
import { computeInvoiceTotals } from '../../src/domain/invoiceTotals.js';
import { defaultSettings } from '../../src/lib/schema.js';

const s = (patch) => Object.assign(defaultSettings(), patch);
const time = (seconds) => ({ type: 'time', seconds, date: '2026-10-01' });
const expense = (amount) => ({ type: 'expense', amount, date: '2026-10-01' });
// 3 rows of 1000 s: hoursFromSeconds(1000) = 0.28, each row round2(0.28*65) = 18.20
const rows3 = () => [time(1000), time(1000), time(1000)];

describe('computeInvoiceTotals (preview)', () => {
  it('Ontario', () => {
    expect(computeInvoiceTotals(rows3(), s({ rate: 65, taxCountry: 'Canada', taxRegion: 'Ontario' }))).toEqual({
      totalHours: 0.84, subtotal: 54.6,
      taxLines: [{ label: 'HST', rate: 0.13, amount: 7.1 }], taxTotal: 7.1, grandTotal: 61.7
    });
  });

  it('Quebec (QST 5.44635… rounds to 5.45)', () => {
    const t = computeInvoiceTotals(rows3(), s({ rate: 65, taxCountry: 'Canada', taxRegion: 'Quebec' }));
    expect(t.subtotal).toBe(54.6);
    expect(t.taxLines.map((l) => l.amount)).toEqual([2.73, 5.45]);
    expect(t.taxTotal).toBe(8.18);
    expect(t.grandTotal).toBe(62.78);
  });

  it('British Columbia', () => {
    const t = computeInvoiceTotals(rows3(), s({ rate: 65, taxCountry: 'Canada', taxRegion: 'British Columbia' }));
    expect(t.taxLines.map((l) => l.amount)).toEqual([2.73, 3.82]);
    expect(t.taxTotal).toBe(6.55);
    expect(t.grandTotal).toBe(61.15);
  });

  it('Nova Scotia', () => {
    const t = computeInvoiceTotals(rows3(), s({ rate: 65, taxCountry: 'Canada', taxRegion: 'Nova Scotia' }));
    expect(t.taxTotal).toBe(7.64);
    expect(t.grandTotal).toBe(62.24);
  });

  it('no tax', () => {
    const t = computeInvoiceTotals(rows3(), s({ rate: 65 }));
    expect(t.taxLines).toEqual([]);
    expect(t.taxTotal).toBe(0);
    expect(t.grandTotal).toBe(54.6);
  });

  it('adds expenses to the subtotal but not to hours', () => {
    const t = computeInvoiceTotals(rows3().concat([expense(12.5)]), s({ rate: 65, taxCountry: 'Canada', taxRegion: 'Ontario' }));
    expect(t.totalHours).toBe(0.84);
    expect(t.subtotal).toBe(67.1);
    expect(t.taxTotal).toBe(8.72);
    expect(t.grandTotal).toBe(75.82);
  });

  it('empty rows give zeros and a zero tax line', () => {
    expect(computeInvoiceTotals([], s({ rate: 65, taxCountry: 'Canada', taxRegion: 'Ontario' }))).toEqual({
      totalHours: 0, subtotal: 0, taxLines: [{ label: 'HST', rate: 0.13, amount: 0 }], taxTotal: 0, grandTotal: 0
    });
  });

  it('a rate of 0 or undefined gives a time amount of 0 while hours still count', () => {
    for (const rate of [0, undefined]) {
      const t = computeInvoiceTotals(rows3(), s({ rate }));
      expect(t.totalHours).toBe(0.84);
      expect(t.subtotal).toBe(0);
      expect(t.grandTotal).toBe(0);
    }
  });

  it('custom US lines', () => {
    const t = computeInvoiceTotals(rows3(), s({ rate: 65, taxCountry: 'United States', taxCustomLabel1: 'State', taxCustomRate1: 0.06, taxCustomLabel2: 'City', taxCustomRate2: 0.02 }));
    expect(t.taxLines).toEqual([{ label: 'State', rate: 0.06, amount: 3.28 }, { label: 'City', rate: 0.02, amount: 1.09 }]);
    expect(t.taxTotal).toBe(4.37);
    expect(t.grandTotal).toBe(58.97);
  });

  it('does not mutate its inputs', () => {
    const rows = rows3().concat([expense(12.5)]);
    const settings = s({ rate: 65, taxCountry: 'Canada', taxRegion: 'Quebec' });
    const rowsCopy = JSON.parse(JSON.stringify(rows));
    const settingsCopy = JSON.parse(JSON.stringify(settings));
    computeInvoiceTotals(rows, settings);
    expect(rows).toEqual(rowsCopy);
    expect(settings).toEqual(settingsCopy);
  });
});
