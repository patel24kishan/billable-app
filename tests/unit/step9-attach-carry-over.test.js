// Step 9 (D2): receipt "attach" choices carried over by id when the preview reloads.
import { describe, it, expect } from 'vitest';
import { applyAttachReceipt } from '../../src/services/invoices.js';

const R1 = 'data:image/png;base64,ONE';
const R2 = 'data:image/png;base64,TWO';
const ex = (id, receiptData, extra) => Object.assign({ type: 'expense', id, amount: 10, receiptData }, extra);
const time = (id) => ({ type: 'time', id, seconds: 3600 });
const flags = (rows) => rows.map((r) => r.attachReceipt);

describe('applyAttachReceipt', () => {
  it('fresh preview (no previous rows): every receipt attached, others untouched', () => {
    const rows = applyAttachReceipt([time('t1'), ex('a', R1), ex('b', null)], null);
    expect(flags(rows)).toEqual([undefined, true, undefined]);
  });

  it('keeps each previous choice by id, regardless of position or other edits', () => {
    const prev = [ex('a', R1, { attachReceipt: false }), ex('b', R2, { attachReceipt: true })];
    const next = [ex('b', R2, { amount: 99 }), time('t1'), ex('a', R1, { title: 'edited', amount: 5 })];
    applyAttachReceipt(next, prev);
    expect(flags(next)).toEqual([true, undefined, false]);
  });

  it('new rows and receipts added to an expense that had none default to attached', () => {
    const prev = [ex('b', null), ex('c', R1, { attachReceipt: false })];
    const next = [ex('b', R1), ex('c', R1), ex('d', R1)];
    applyAttachReceipt(next, prev);
    expect(flags(next)).toEqual([true, false, true]);
  });

  it('a replaced receipt keeps the previous choice exactly (unticked or ticked)', () => {
    const prev = [ex('a', R1, { attachReceipt: false }), ex('b', R1, { attachReceipt: true })];
    const next = [ex('a', R2), ex('b', R2)];
    applyAttachReceipt(next, prev);
    expect(flags(next)).toEqual([false, true]);
  });

  it('a removed receipt leaves no choice on the row', () => {
    const prev = [ex('a', R1, { attachReceipt: false })];
    const next = applyAttachReceipt([ex('a', null)], prev);
    expect(next[0].attachReceipt).toBeUndefined();
  });

  it('a previous row without an explicit flag counts as attached', () => {
    const next = applyAttachReceipt([ex('a', R1)], [ex('a', R1)]);
    expect(next[0].attachReceipt).toBe(true);
  });
});
