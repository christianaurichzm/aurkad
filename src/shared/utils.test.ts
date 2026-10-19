import { describe, it, expect } from 'vitest';
import { percentile } from './utils.js';

describe('percentile', () => {
  it('returns a value that actually occurred, not an interpolation', () => {
    const values = [10, 20, 30, 40];
    expect(values).toContain(percentile(values, 50));
    expect(values).toContain(percentile(values, 95));
  });

  it('picks the nearest rank', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 100)).toBe(10);
  });

  it('handles a single value', () => {
    expect(percentile([42], 95)).toBe(42);
  });

  it('returns zero for no samples rather than NaN', () => {
    expect(percentile([], 95)).toBe(0);
  });
});
