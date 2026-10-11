import { describe, it, expect } from 'vitest';
import { buildPdfDoc } from '../../src/services/invoicePdf.js';

const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function sample(receipts) {
  return {
    number: 3, month: '2026-10', generatedAt: '2026-10-10T12:00:00.000Z',
    from: { name: 'Jordan', email: 'j@x.test', address: 'Line 1\nLine 2' },
    to: { name: 'Acme', email: 'a@acme.test', address: '1 Main St' },
    currency: '$', rate: 65, totalHours: 1.28, totalAmount: 95.7,
    taxLines: [{ label: 'HST', rate: 0.13, amount: 12.44 }], taxTotal: 12.44, grandTotal: 108.14,
    notes: 'Net 15',
    lineItems: [
      { type: 'time', date: '2026-10-01', description: 'Design', hours: 1.28, amount: 83.2 },
      { type: 'expense', date: '2026-10-02', description: 'Paper', amount: 12.5 }
    ],
    receipts
  };
}

describe('buildPdfDoc', () => {
  it('has the autoTable plugin attached', () => {
    const doc = buildPdfDoc(sample([]));
    expect(typeof doc.autoTable).toBe('function');
    expect(doc.lastAutoTable.finalY).toBeGreaterThan(0);
  });

  it('is one page without receipts', () => {
    expect(buildPdfDoc(sample([])).getNumberOfPages()).toBe(1);
    const noReceipts = sample(undefined);
    delete noReceipts.receipts;
    expect(buildPdfDoc(noReceipts).getNumberOfPages()).toBe(1);
  });

  it('adds one page per receipt', () => {
    const r = { title: 'Paper', dataUrl: PNG_1x1, type: 'image/png', width: 1, height: 1 };
    expect(buildPdfDoc(sample([r])).getNumberOfPages()).toBe(2);
    expect(buildPdfDoc(sample([r, { ...r, title: 'Ink' }, { ...r, title: 'Bad', dataUrl: 'data:image/jpeg;base64,xx', type: 'image/jpeg' }])).getNumberOfPages()).toBe(4);
  });

  it('outputs a PDF blob', () => {
    const blob = buildPdfDoc(sample([])).output('blob');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(1000);
  });

  it('accepts an old snapshot without grandTotal/taxLines', () => {
    const old = sample([]);
    delete old.grandTotal; delete old.taxLines;
    expect(() => buildPdfDoc(old)).not.toThrow();
  });
});
