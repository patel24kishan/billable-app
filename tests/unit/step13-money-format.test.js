// Step 13: PDF amounts use money(amount, invoice.currency): en-US grouping, 2 decimals, the invoice's own symbol.
import { describe, it, expect } from 'vitest';
import { jsPDF } from 'jspdf';
import { buildPdfDoc } from '../../src/services/invoicePdf.js';

const PAGE_H = 792, PAGE_W = 612, MARGIN = 48, AMOUNT_COL_W = 80, PAD = 6;

function pageTexts(doc, page) {
  const out = [];
  let lx = 0, ly = 0, tl = 0, font = '', size = 0;
  for (const raw of doc.internal.pages[page]) {
    for (let op of String(raw).split('\n')) {
      let m;
      if (op.startsWith('T* ')) { ly -= tl; op = op.slice(3); }
      if (op === 'BT') { lx = 0; ly = 0; }
      else if ((m = op.match(/^\/(\S+) (\S+) Tf$/))) { font = m[1]; size = parseFloat(m[2]); }
      else if ((m = op.match(/^(\S+) TL$/))) { tl = parseFloat(m[1]); }
      else if ((m = op.match(/^(\S+) (\S+) Td$/))) { lx += parseFloat(m[1]); ly += parseFloat(m[2]); }
      else if (op === 'T*') { ly -= tl; }
      else if ((m = op.match(/^\((.*)\) Tj$/))) out.push({ text: m[1].replace(/\\([()\\])/g, '$1'), x: lx, y: PAGE_H - ly, font, size });
    }
  }
  return out;
}
const allTexts = (doc) => Array.from({ length: doc.getNumberOfPages() }, (_, i) => pageTexts(doc, i + 1)).flat();

const measurer = new jsPDF({ unit: 'pt', format: 'letter' });
function right(t) {
  measurer.setFont('helvetica', t.font === 'F2' ? 'bold' : 'normal');
  measurer.setFontSize(t.size);
  return t.x + measurer.getTextWidth(t.text);
}

function makeInvoice(over = {}) {
  return Object.assign({
    number: 7, month: '2026-10', generatedAt: '2026-10-10T12:00:00.000Z',
    from: { name: 'Jordan', email: 'j@x.test', address: 'L1' },
    to: { name: 'Acme', email: 'a@acme.test', address: '1 Main St' },
    currency: '$', rate: 1234.5, totalHours: 2, totalAmount: 1234.5 + 999.99,
    taxLines: [{ label: 'GST', rate: 0.05, amount: 1000 }, { label: 'QST', rate: 0.09975, amount: 1234567.89 }],
    taxTotal: 1235567.89, grandTotal: 1234.5 + 999.99 + 1235567.89, notes: '',
    lineItems: [
      { type: 'time', date: '2026-10-01', description: 'A', hours: 1, amount: 1234.5 },
      { type: 'expense', date: '2026-10-02', description: 'B', hours: 0, amount: 999.99 }
    ], receipts: []
  }, over);
}

describe('Step 13: PDF money format', () => {
  it('formats line items, subtotal, tax lines, total due and rate with grouping', () => {
    const texts = allTexts(buildPdfDoc(makeInvoice())).map((t) => t.text);
    for (const s of ['$1,234.50', '$999.99', '$2,234.49', '$1,000.00', '$1,234,567.89', '$1,237,802.38', 'Rate: $1,234.50 / hour  ·  Total hours: 2.00']) {
      expect(texts, s).toContain(s);
    }
    expect(texts.some((t) => /^\$\d{4,}\./.test(t))).toBe(false);
  });

  it('keeps hours at toFixed(2)', () => {
    const texts = allTexts(buildPdfDoc(makeInvoice({ lineItems: [{ type: 'time', date: '2026-10-01', description: 'A', hours: 1234.5, amount: 1 }] }))).map((t) => t.text);
    expect(texts).toContain('1234.50');
  });

  it('uses the invoice currency symbol, not settings', () => {
    const texts = allTexts(buildPdfDoc(makeInvoice({ currency: '£' })));
    const strs = texts.map((t) => t.text);
    expect(strs).toContain('£1,234.50');
    expect(strs).toContain('£1,234,567.89');
    expect(strs).toContain('Rate: £1,234.50 / hour  ·  Total hours: 2.00');
    expect(strs.some((s) => s.includes('$'))).toBe(false);
  });

  it('an empty currency falls back to "$" (same as money() everywhere else)', () => {
    const strs = allTexts(buildPdfDoc(makeInvoice({ currency: '' }))).map((t) => t.text);
    expect(strs).toContain('$1,234.50');
  });

  it('wide amounts stay right-aligned at the same right edges and fit the amount column', () => {
    const texts = allTexts(buildPdfDoc(makeInvoice()));
    const amountRight = PAGE_W - MARGIN - PAD, labelRight = amountRight - AMOUNT_COL_W + 0;
    for (const s of ['$1,234.50', '$999.99', '$2,234.49', '$1,000.00', '$1,234,567.89', '$1,237,802.38']) {
      const t = texts.find((x) => x.text === s);
      expect(right(t), s).toBeCloseTo(amountRight, 0);
      expect(t.x, s).toBeGreaterThan(PAGE_W - MARGIN - AMOUNT_COL_W); // does not spill left of the column
    }
    for (const label of ['Subtotal', 'GST (5%)', 'QST (9.975%)', 'Total due']) {
      const hits = texts.filter((x) => x.text === label);
      expect(hits, label).toHaveLength(1);
      expect(right(hits[0]), label).toBeCloseTo(labelRight, 0);
    }
  });
});
