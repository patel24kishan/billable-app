// Step 11 (Phase 4: B6, B5, B4): invoice PDF layout.
// Layout facts are read from the generated PDF content streams: every text draw is recorded as
// { text, x, y, page, font, size } with y measured from the TOP of the page (jsPDF/autotable coordinates).
import { describe, it, expect } from 'vitest';
import { jsPDF } from 'jspdf';
import { buildPdfDoc } from '../../src/services/invoicePdf.js';

const PAGE_W = 612, PAGE_H = 792, MARGIN = 48, BOTTOM = PAGE_H - MARGIN;
const AMOUNT_COL_W = 80, PAD = 6;

function unescapePdf(s) {
  return s.replace(/\\([()\\])/g, '$1');
}

// Parse one page's content stream into text draws (handles Td, T* and TL inside BT/ET blocks).
function pageTexts(doc, page) {
  const ops = doc.internal.pages[page];
  const out = [];
  let lx = 0, ly = 0, tl = 0, font = '', size = 0;
  for (const raw of ops) {
    for (let op of String(raw).split('\n')) {
      let m;
      // Multi-line doc.text(array) emits "T* (line) Tj" on one line: move down a line, then draw.
      if (op.startsWith('T* ')) { ly -= tl; op = op.slice(3); }
      if (op === 'BT') { lx = 0; ly = 0; }
      else if ((m = op.match(/^\/(\S+) (\S+) Tf$/))) { font = m[1]; size = parseFloat(m[2]); }
      else if ((m = op.match(/^(\S+) TL$/))) { tl = parseFloat(m[1]); }
      else if ((m = op.match(/^(\S+) (\S+) Td$/))) { lx += parseFloat(m[1]); ly += parseFloat(m[2]); }
      else if (op === 'T*') { ly -= tl; }
      else if ((m = op.match(/^\((.*)\) Tj$/))) {
        out.push({ text: unescapePdf(m[1]), x: lx, y: PAGE_H - ly, page, font, size });
      }
    }
  }
  return out;
}

function allTexts(doc) {
  const n = doc.getNumberOfPages();
  const all = [];
  for (let p = 1; p <= n; p++) all.push(...pageTexts(doc, p));
  return all;
}

// Straight lines drawn on a page ("x y m" followed by "x y l"), y from the top.
function pageLines(doc, page) {
  const ops = doc.internal.pages[page].join('\n').split('\n');
  const lines = [];
  for (let i = 0; i < ops.length - 1; i++) {
    const a = ops[i].match(/^(\S+) (\S+) m$/), b = ops[i + 1].match(/^(\S+) (\S+) l$/);
    if (a && b) lines.push({ x1: +a[1], y1: PAGE_H - +a[2], x2: +b[1], y2: PAGE_H - +b[2] });
  }
  return lines;
}

const measurer = new jsPDF({ unit: 'pt', format: 'letter' });
function textWidth(t) {
  measurer.setFont('helvetica', t.font === 'F2' ? 'bold' : 'normal');
  measurer.setFontSize(t.size);
  return measurer.getTextWidth(t.text);
}

function makeInvoice({ items = 2, taxLines, notes = 'Net 15', fromAddress = 'Line 1\nLine 2', fromEmail = 'j@x.test' } = {}) {
  const lineItems = [];
  for (let i = 1; i <= items; i++) {
    lineItems.push({ type: 'time', date: '2026-10-' + String(((i - 1) % 28) + 1).padStart(2, '0'), description: 'Task ' + i, hours: 1, amount: 65 });
  }
  const totalAmount = items * 65;
  const tl = taxLines || [
    { label: 'GST', rate: 0.05, amount: +(totalAmount * 0.05).toFixed(2) },
    { label: 'QST', rate: 0.09975, amount: +(totalAmount * 0.09975).toFixed(2) }
  ];
  const taxTotal = tl.reduce((s, t) => s + t.amount, 0);
  return {
    number: 7, month: '2026-10', generatedAt: '2026-10-10T12:00:00.000Z',
    from: { name: 'Jordan Design Studio', email: fromEmail, address: fromAddress },
    to: { name: 'Acme', email: 'a@acme.test', address: '1 Main St' },
    currency: '$', rate: 65, totalHours: items, totalAmount,
    taxLines: tl, taxTotal, grandTotal: totalAmount + taxTotal,
    notes, lineItems, receipts: []
  };
}

const notesOf = (n) => Array.from({ length: n }, (_, i) => 'Note line ' + (i + 1) + ': payment terms and remittance detail.').join('\n');

describe('Step 11 / B5: foot labels span the first three columns', () => {
  const taxLines = [
    { label: 'QST', rate: 0.09975, amount: 6.48 },
    { label: 'Sales Tax', rate: 0.08875, amount: 5.77 },
    { label: 'County tax', rate: 0.015, amount: 0.98 }
  ];
  const labels = ['Subtotal', 'QST (9.975%)', 'Sales Tax (8.875%)', 'County tax (1.5%)', 'Total due'];
  const amounts = ['$65.00', '$6.48', '$5.77', '$0.98', '$78.23'];

  it('draws each foot label as one line, right-aligned at the end of the label span', () => {
    const doc = buildPdfDoc(makeInvoice({ items: 1, taxLines }));
    const texts = allTexts(doc);
    const labelRight = PAGE_W - MARGIN - AMOUNT_COL_W - PAD;
    for (const label of labels) {
      const hits = texts.filter((t) => t.text === label);
      expect(hits, label).toHaveLength(1);
      expect(textWidth(hits[0]) + hits[0].x, label).toBeCloseTo(labelRight, 0);
    }
    // No fragment of a wrapped label (e.g. "(9.975%)" alone on a second line) is drawn anywhere.
    expect(texts.some((t) => /^\(\d/.test(t.text) || ['QST', 'Sales Tax', 'County tax', 'Sales', 'County', 'Tax', 'tax'].includes(t.text))).toBe(false);
  });

  it('right-aligns the amounts in the last column, on the same baseline as their labels', () => {
    const doc = buildPdfDoc(makeInvoice({ items: 1, taxLines }));
    const texts = allTexts(doc);
    const amountRight = PAGE_W - MARGIN - PAD;
    labels.forEach((label, i) => {
      const l = texts.find((t) => t.text === label);
      const a = texts.filter((t) => t.text === amounts[i] && Math.abs(t.y - l.y) < 0.5);
      expect(a, amounts[i]).toHaveLength(1);
      expect(textWidth(a[0]) + a[0].x, amounts[i]).toBeCloseTo(amountRight, 0);
    });
  });

  it('keeps only the last row (Total due) bold', () => {
    const doc = buildPdfDoc(makeInvoice({ items: 1, taxLines }));
    const texts = allTexts(doc);
    expect(texts.find((t) => t.text === 'Total due').font).toBe('F2');
    expect(texts.find((t) => t.text === '$78.23').font).toBe('F2');
    expect(texts.find((t) => t.text === 'Subtotal').font).toBe('F1');
    expect(texts.find((t) => t.text === 'QST (9.975%)').font).toBe('F1');
  });
});

describe('Step 11 / B4: totals once, and the rate line and notes stay inside the page', () => {
  const footLabels = ['Subtotal', 'GST (5%)', 'QST (9.975%)', 'Total due'];

  it('draws the totals once, on the last table page, for a 60-row invoice', () => {
    const doc = buildPdfDoc(makeInvoice({ items: 60 }));
    const texts = allTexts(doc);
    const lastRowPage = texts.find((t) => t.text === 'Task 60').page;
    expect(lastRowPage).toBeGreaterThan(1);
    for (const label of footLabels) {
      const hits = texts.filter((t) => t.text === label);
      expect(hits.map((h) => h.page), label).toEqual([lastRowPage]);
    }
    // The foot sits below the last body row.
    expect(texts.find((t) => t.text === 'Subtotal').y).toBeGreaterThan(texts.find((t) => t.text === 'Task 60').y);
  });

  it('draws the totals once for a short invoice, which stays one page', () => {
    const doc = buildPdfDoc(makeInvoice({ items: 3 }));
    expect(doc.getNumberOfPages()).toBe(1);
    const texts = allTexts(doc);
    for (const label of footLabels) expect(texts.filter((t) => t.text === label), label).toHaveLength(1);
  });

  it('with 18 rows the rate line and notes do not run past the bottom margin', () => {
    const doc = buildPdfDoc(makeInvoice({ items: 18, notes: notesOf(4) }));
    const texts = allTexts(doc);
    const rate = texts.filter((t) => t.text.startsWith('Rate: '));
    const notes = texts.filter((t) => t.text.startsWith('Note line '));
    expect(rate).toHaveLength(1);
    expect(notes.map((n) => n.text.split(':')[0])).toEqual(['Note line 1', 'Note line 2', 'Note line 3', 'Note line 4']);
    for (const t of [...rate, ...notes]) expect(t.y, t.text).toBeLessThanOrEqual(BOTTOM);
    for (const t of texts) expect(t.y, t.text).toBeLessThanOrEqual(PAGE_H);
    // The table ends low on page 1, so the block moved to a new page, starting at the top margin.
    expect(doc.getNumberOfPages()).toBe(2);
    expect(rate[0].page).toBe(2);
    expect(rate[0].y).toBe(MARGIN);
    expect(notes.every((n) => n.page === 2)).toBe(true);
  });

  it('paginates 40 lines of notes line by line with nothing past the bottom margin', () => {
    const doc = buildPdfDoc(makeInvoice({ items: 10, notes: notesOf(40) }));
    const texts = allTexts(doc);
    const notes = texts.filter((t) => t.text.startsWith('Note line '));
    expect(notes.map((n) => n.text.split(':')[0])).toEqual(Array.from({ length: 40 }, (_, i) => 'Note line ' + (i + 1)));
    for (const t of notes) expect(t.y, t.text).toBeLessThanOrEqual(BOTTOM);
    for (const t of texts) expect(t.y, t.text).toBeLessThanOrEqual(PAGE_H);
    expect(doc.getNumberOfPages()).toBe(2);
    // Lines keep their order: the page never goes back, y grows within a page, a new page starts at the top margin.
    for (let i = 1; i < notes.length; i++) {
      const a = notes[i - 1], b = notes[i];
      expect(b.page >= a.page).toBe(true);
      if (b.page === a.page) expect(b.y).toBeGreaterThan(a.y);
      else expect(b.y).toBe(MARGIN);
    }
  });

  it('adds no extra (blank) page when everything fits', () => {
    for (const items of [1, 5, 12]) {
      const doc = buildPdfDoc(makeInvoice({ items, notes: notesOf(3) }));
      expect(doc.getNumberOfPages(), items + ' items').toBe(1);
    }
    for (const items of [18, 30, 60]) {
      const doc = buildPdfDoc(makeInvoice({ items, notes: notesOf(3) }));
      for (let p = 1; p <= doc.getNumberOfPages(); p++) expect(pageTexts(doc, p).length, items + ' items, page ' + p).toBeGreaterThan(0);
    }
  });
});

describe('Step 11 / B6: BILL TO flows below the business details', () => {
  it('moves BILL TO (and the divider) below a long business address', () => {
    const doc = buildPdfDoc(makeInvoice({ fromAddress: 'Suite 400\n123 Long Street\nBuilding C\nMontreal, QC\nH2X 1Y4' }));
    const texts = pageTexts(doc, 1);
    const lastBusiness = texts.find((t) => t.text === 'H2X 1Y4');
    const billTo = texts.find((t) => t.text === 'BILL TO');
    expect(billTo.y - lastBusiness.y).toBeGreaterThanOrEqual(20);
    const divider = pageLines(doc, 1).find((l) => l.x1 === MARGIN && l.x2 === PAGE_W - MARGIN && l.y1 === l.y2);
    expect(divider.y1).toBeCloseTo(billTo.y - 14, 5);
    expect(divider.y1).toBeGreaterThan(lastBusiness.y + 4);
    // The client block and the table follow.
    expect(texts.find((t) => t.text === 'Acme').y).toBe(billTo.y + 16);
    expect(texts.find((t) => t.text === 'Date').y).toBeGreaterThan(texts.find((t) => t.text === '1 Main St').y);
  });

  it('keeps BILL TO at y=140 for a normal short business block', () => {
    for (const inv of [makeInvoice(), makeInvoice({ fromAddress: '', fromEmail: '' })]) {
      const doc = buildPdfDoc(inv);
      const texts = pageTexts(doc, 1);
      expect(texts.find((t) => t.text === 'BILL TO').y).toBe(140);
      expect(pageLines(doc, 1).some((l) => l.y1 === 126 && l.y2 === 126)).toBe(true);
    }
  });
});
