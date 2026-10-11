// Step 12 (B7): the invoice PDF header uses the en-US 'MMM d, yyyy' date of the LOCAL day of
// generatedAt, and a 22 pt title that does not collide with the lines below it.
import { describe, it, expect } from 'vitest';
import { buildPdfDoc } from '../../src/services/invoicePdf.js';

const PAGE_H = 792;

function texts(doc) {
  const out = [];
  let ly = 0, size = 0;
  for (const raw of doc.internal.pages[1]) {
    for (const op of String(raw).split('\n')) {
      let m;
      if (op === 'BT') ly = 0;
      else if ((m = op.match(/^\/\S+ (\S+) Tf$/))) size = parseFloat(m[1]);
      else if ((m = op.match(/^(\S+) (\S+) Td$/))) ly += parseFloat(m[2]);
      else if ((m = op.match(/^\((.*)\) Tj$/))) out.push({ text: m[1], y: PAGE_H - ly, size });
    }
  }
  return out;
}

function invoice(generatedAt) {
  return {
    number: 3, month: '2026-10', generatedAt,
    from: { name: 'Jordan', email: 'j@x.test', address: 'Line 1' },
    to: { name: 'Acme', email: 'a@acme.test', address: '1 Main St' },
    currency: '$', rate: 65, totalHours: 1, totalAmount: 65,
    taxLines: [], taxTotal: 0, grandTotal: 65, notes: '',
    lineItems: [{ type: 'time', date: '2026-10-01', description: 'Design', hours: 1, amount: 65 }],
    receipts: []
  };
}

describe('step 12: invoice PDF header', () => {
  it('prints Date as en-US MMM d, yyyy from the LOCAL date of generatedAt', () => {
    // 23:30 local on Oct 9: in the Americas the UTC date is already Oct 10.
    const gen = new Date(2026, 9, 9, 23, 30, 0).toISOString();
    const t = texts(buildPdfDoc(invoice(gen)));
    expect(t.map((x) => x.text)).toContain('Date: Oct 9, 2026');
    // and 00:20 local on Oct 10: in Asia the UTC date is still Oct 9.
    const gen2 = new Date(2026, 9, 10, 0, 20, 0).toISOString();
    expect(texts(buildPdfDoc(invoice(gen2))).map((x) => x.text)).toContain('Date: Oct 10, 2026');
  });

  it('draws the INVOICE title at 22 pt with clear space above the number line', () => {
    const t = texts(buildPdfDoc(invoice('2026-10-10T12:00:00.000Z')));
    const title = t.find((x) => x.text === 'INVOICE');
    const num = t.find((x) => x.text === 'Invoice #3');
    expect(title.size).toBe(22);
    // number line (10 pt) top edge must sit below the title baseline (descenders ~ 0.25 * 22)
    expect(num.y - title.y).toBeGreaterThan(22 * 0.25 + 10 * 0.7 - 4);
  });
});
