import { describe, it, expect } from 'vitest';
import { ObjectPool } from './objectPool';

const make = (size: number) =>
  new ObjectPool<{ active: boolean; n: number }>(size, () => ({
    active: false,
    n: 0,
  }));

describe('ObjectPool', () => {
  it('hands out a free slot and counts it once claimed', () => {
    const pool = make(2);
    expect(pool.capacity).toBe(2);
    expect(pool.activeCount()).toBe(0);

    const a = pool.acquire()!;
    expect(pool.activeCount()).toBe(0); // acquire does not claim; the caller does
    a.active = true;
    expect(pool.activeCount()).toBe(1);
  });

  it('returns null when every slot is taken, rather than growing', () => {
    const pool = make(2);
    pool.acquire()!.active = true;
    pool.acquire()!.active = true;

    expect(pool.acquire()).toBeNull();
    expect(pool.capacity).toBe(2);
  });

  it('walks only the active slots', () => {
    const pool = make(3);
    const a = pool.acquire()!;
    a.active = true;
    a.n = 7;

    const seen: number[] = [];
    pool.forEach((item) => seen.push(item.n));

    expect(seen).toEqual([7]);
  });

  it('lets the callback recycle a slot, which the next acquire reuses', () => {
    const pool = make(1);
    const a = pool.acquire()!;
    a.active = true;

    pool.forEach((item) => {
      item.active = false;
    });

    expect(pool.activeCount()).toBe(0);
    expect(pool.acquire()).toBe(a);
  });
});
