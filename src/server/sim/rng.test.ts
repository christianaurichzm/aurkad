import { describe, it, expect } from 'vitest';
import {
  seedRng,
  nextRandom,
  randomInt,
  randomChance,
  randomPick,
} from './rng.js';

describe('rng', () => {
  it('is reproducible for a given seed', () => {
    seedRng(42);
    const a = [nextRandom(), nextRandom(), nextRandom()];
    seedRng(42);
    const b = [nextRandom(), nextRandom(), nextRandom()];

    expect(a).toEqual(b);
  });

  it('produces different sequences for different seeds', () => {
    seedRng(1);
    const a = nextRandom();
    seedRng(2);
    const b = nextRandom();

    expect(a).not.toEqual(b);
  });

  it('randomInt stays within range', () => {
    seedRng(7);
    for (let i = 0; i < 100; i++) {
      const n = randomInt(4);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(4);
    }
  });

  it('randomChance is deterministic and bounded', () => {
    seedRng(99);
    expect(randomChance(0)).toBe(false);
    seedRng(99);
    expect(randomChance(100)).toBe(true);
  });

  it('randomPick returns undefined for an empty array', () => {
    expect(randomPick([])).toBeUndefined();
  });
});
