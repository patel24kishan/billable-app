import { describe, it, expect } from 'vitest';

describe('test harness', () => {
  it('has IndexedDB available', () => {
    expect(typeof indexedDB.open).toBe('function');
  });
});
