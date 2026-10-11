import { describe, it, expect } from 'vitest';
import { buildPreviewRows, buildInvoiceDoc, invoicePdfFilename } from '../../src/services/invoices.js';
import { defaultSettings } from '../../src/lib/schema.js';

const s = (patch) => Object.assign(defaultSettings(), patch);

describe('buildPreviewRows', () => {
  const entries = [
    { id: 'e1', date: '2026-10-05', seconds: 3600, invoiced: false },
    { id: 'e2', date: '2026-10-01', seconds: 1800, invoiced: true },
    { id: 'e3', date: '2026-10-09', seconds: 600 }
  ];
  const expenses = [
    { id: 'x1', date: '2026-10-03', amount: 10, invoiced: false },
    { id: 'x2', date: '2026-10-07', amount: 5, invoiced: true }
  ];

  it('drops invoiced rows, sorts by date, adds type and id', () => {
    const rows = buildPreviewRows(entries, expenses, false);
    expect(rows.map((r) => r.id)).toEqual(['x1', 'e1', 'e3']);
    expect(rows.map((r) => r.type)).toEqual(['expense', 'time', 'time']);
    expect(rows[1]).toEqual({ type: 'time', id: 'e1', date: '2026-10-05', seconds: 3600, invoiced: false });
  });

  it('keeps invoiced rows when includeBilled', () => {
    const rows = buildPreviewRows(entries, expenses, true);
    expect(rows.map((r) => r.id)).toEqual(['e2', 'x1', 'e1', 'x2', 'e3']);
  });

  it('does not mutate its inputs', () => {
    const copy = JSON.parse(JSON.stringify(entries));
    buildPreviewRows(entries, expenses, true);
    expect(entries).toEqual(copy);
  });
});

describe('buildInvoiceDoc (snapshot)', () => {
  const rows = [
    { type: 'time', id: 'e1', date: '2026-10-01', seconds: 3600, description: 'Design' },
    { type: 'expense', id: 'x1', date: '2026-10-02', amount: 10, title: 'Fonts', receiptData: 'data:image/png;base64,AA' },
    { type: 'expense', id: 'x2', date: '2026-10-03', amount: 0, title: 'Free' },
    { type: 'time', id: 'e2', date: '2026-10-04', seconds: 3600 }
  ];
  const settings = s({
    rate: 65, currency: '$', nextInvoiceNumber: 7, businessName: 'Jordan', businessEmail: 'j@x.test', businessAddress: 'Halifax',
    notes: 'Net 15', taxCountry: 'Canada', taxRegion: 'Ontario'
  });
  const client = { id: 'c1', name: 'Acme Co', email: 'a@acme.test', address: '1 Main St' };
  const generatedAt = '2026-10-10T12:00:00.000Z';

  it('builds the snapshot', () => {
    const { invoiceDoc, timeRows, expenseRows } = buildInvoiceDoc({ rows, meta: { client, month: '2026-10' }, settings, generatedAt });
    expect(timeRows.map((r) => r.id)).toEqual(['e1', 'e2']);
    expect(expenseRows.map((r) => r.id)).toEqual(['x1', 'x2']);
    expect(invoiceDoc).toEqual({
      number: 7, month: '2026-10', generatedAt,
      from: { name: 'Jordan', email: 'j@x.test', address: 'Halifax' },
      to: { name: 'Acme Co', email: 'a@acme.test', address: '1 Main St' },
      currency: '$', rate: 65,
      totalHours: 2, totalAmount: 140,
      taxLines: [{ label: 'HST', rate: 0.13, amount: 18.2 }], taxTotal: 18.2, grandTotal: 158.2,
      notes: 'Net 15',
      lineItems: [
        { type: 'time', date: '2026-10-01', description: 'Design', hours: 1, amount: 65 },
        { type: 'expense', date: '2026-10-02', description: 'Fonts', amount: 10 },
        { type: 'expense', date: '2026-10-03', description: 'Free', amount: 0 },
        { type: 'time', date: '2026-10-04', description: '', hours: 1, amount: 65 }
      ],
      receipts: [{ title: 'Fonts', dataUrl: 'data:image/png;base64,AA', type: 'image/jpeg', width: 800, height: 600 }]
    });
  });

  it('keeps stored receipt type/size when present', () => {
    const r = [{ type: 'expense', id: 'x', date: '2026-10-02', amount: 1, title: 'T', receiptData: 'd', receiptType: 'image/png', receiptW: 3, receiptH: 4 }];
    const { invoiceDoc } = buildInvoiceDoc({ rows: r, meta: { client, month: '2026-10' }, settings, generatedAt });
    expect(invoiceDoc.receipts).toEqual([{ title: 'T', dataUrl: 'd', type: 'image/png', width: 3, height: 4 }]);
  });

  it('defaults: number 1, no client, no rate, no currency', () => {
    const { invoiceDoc } = buildInvoiceDoc({
      rows: [rows[0]], meta: { client: undefined, month: '2026-10' },
      settings: s({ nextInvoiceNumber: 0, rate: 0, currency: '' }), generatedAt
    });
    expect(invoiceDoc.number).toBe(1);
    expect(invoiceDoc.to).toEqual({ name: 'Client', email: '', address: '' });
    expect(invoiceDoc.currency).toBe('$');
    expect(invoiceDoc.rate).toBe(0);
    expect(invoiceDoc.totalHours).toBe(1);
    expect(invoiceDoc.totalAmount).toBe(0);
    expect(invoiceDoc.taxLines).toEqual([]);
    expect(invoiceDoc.notes).toBe('');
  });
});

describe('buildInvoiceDoc totals (B1: per-entry rounding, same as the preview)', () => {
  const client = { id: 'c1', name: 'Acme Co', email: '', address: '' };
  const generatedAt = '2026-10-10T12:00:00.000Z';
  const three = [1, 2, 3].map((n) => ({ type: 'time', id: 'e' + n, date: '2026-10-0' + n, seconds: 1000 }));
  const build = (rows, settings) => buildInvoiceDoc({ rows, meta: { client, month: '2026-10' }, settings, generatedAt }).invoiceDoc;
  const sumLines = (doc) => Math.round(doc.lineItems.reduce((a, l) => a + l.amount, 0) * 100) / 100;

  it('3 x 1000 s at 65/h in Ontario: 0.84 h, 54.60, HST 7.10, 61.70', () => {
    const doc = build(three, s({ rate: 65, taxCountry: 'Canada', taxRegion: 'Ontario' }));
    expect(doc.lineItems.map((l) => [l.hours, l.amount])).toEqual([[0.28, 18.2], [0.28, 18.2], [0.28, 18.2]]);
    expect(doc.totalHours).toBe(0.84);
    expect(doc.totalAmount).toBe(54.6);
    expect(doc.taxLines).toEqual([{ label: 'HST', rate: 0.13, amount: 7.1 }]);
    expect(doc.taxTotal).toBe(7.1);
    expect(doc.grandTotal).toBe(61.7);
    expect(doc.totalAmount).toBe(sumLines(doc));
  });

  it('with an expense: subtotal is the line items sum, tax on the subtotal', () => {
    const rows = three.concat([{ type: 'expense', id: 'x1', date: '2026-10-04', amount: 12.5, title: 'Fonts' }]);
    const doc = build(rows, s({ rate: 65, taxCountry: 'Canada', taxRegion: 'Ontario' }));
    expect(doc.totalHours).toBe(0.84);
    expect(doc.totalAmount).toBe(67.1);
    expect(doc.totalAmount).toBe(sumLines(doc));
    expect(doc.taxLines[0].amount).toBe(8.72);
    expect(doc.taxTotal).toBe(8.72);
    expect(doc.grandTotal).toBe(75.82);
  });

  it('no tax: grand total equals subtotal', () => {
    const doc = build(three, s({ rate: 65 }));
    expect(doc.totalHours).toBe(0.84);
    expect(doc.totalAmount).toBe(54.6);
    expect(doc.totalAmount).toBe(sumLines(doc));
    expect(doc.taxLines).toEqual([]);
    expect(doc.taxTotal).toBe(0);
    expect(doc.grandTotal).toBe(54.6);
  });

  it('zero rate: hours still total per entry, amounts are zero', () => {
    const doc = build(three, s({ rate: 0, taxCountry: 'Canada', taxRegion: 'Ontario' }));
    expect(doc.totalHours).toBe(0.84);
    expect(doc.totalAmount).toBe(0);
    expect(doc.totalAmount).toBe(sumLines(doc));
    expect(doc.taxTotal).toBe(0);
    expect(doc.grandTotal).toBe(0);
  });
});

describe('invoicePdfFilename', () => {
  it('pads the number to 4 digits', () => {
    expect(invoicePdfFilename(7, 'Acme-Co', '2026-10')).toBe('Invoice-0007-Acme-Co-2026-10.pdf');
    expect(invoicePdfFilename(12345, 'client', '2026-01')).toBe('Invoice-12345-client-2026-01.pdf');
  });
});
