import { describe, it, expect } from 'vitest';
import { round2, money } from '../../src/domain/money.js';

// Assumes Node's default en-US ICU locale; all values stay under 1000 (no grouping separators).
describe('round2', () => {
  it('rounds to cents', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(18.2 * 3)).toBe(54.6);
    expect(round2(-1.234)).toBe(-1.23);
    expect(round2(5)).toBe(5);
  });
});

describe('money', () => {
  it('formats with the currency symbol and two decimals', () => {
    expect(money(54.6, '$')).toBe('$54.60');
    expect(money(5, '€')).toBe('€5.00');
  });
  it("falls back to '$' for an empty or missing currency", () => {
    expect(money(5, '')).toBe('$5.00');
    expect(money(5)).toBe('$5.00');
  });
  it('rounds before formatting', () => {
    expect(money(0.1 + 0.2, '$')).toBe('$0.30');
  });
});
