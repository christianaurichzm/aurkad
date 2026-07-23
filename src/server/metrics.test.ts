import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./services/world/gameData.js', () => ({
  getRuntimeState: () => ({ maps: {} }),
}));
vi.mock('./net/connections.js', () => ({ playersWsMap: new Map() }));

import {
  recordTick,
  recordCatchUpTick,
  getTickStats,
  getLastTickAt,
  resetMetricsForTest,
} from './metrics.js';

beforeEach(() => {
  resetMetricsForTest();
});

describe('tick percentiles', () => {
  it('reports zeros before any tick is recorded', () => {
    const s = getTickStats();
    expect(s.samples).toBe(0);
    expect(s.p50Ms).toBe(0);
    expect(s.p99Ms).toBe(0);
    expect(s.maxMs).toBe(0);
  });

  it('computes p50/p95/p99 by nearest rank over the window', () => {
    // 1..100 ms, so the expected ranks are exact and easy to reason about.
    for (let i = 1; i <= 100; i++) recordTick(i, 0);

    const s = getTickStats();
    expect(s.samples).toBe(100);
    expect(s.p50Ms).toBe(50);
    expect(s.p95Ms).toBe(95);
    expect(s.p99Ms).toBe(99);
    expect(s.maxMs).toBe(100);
    expect(s.avgMs).toBe(50.5);
  });

  it('is not skewed by insertion order', () => {
    for (const ms of [100, 1, 50, 99, 2]) recordTick(ms, 0);
    const s = getTickStats();
    expect(s.maxMs).toBe(100);
    expect(s.p50Ms).toBe(50);
  });

  it('keeps sub-millisecond resolution', () => {
    for (const ms of [0.2, 0.4, 0.6, 0.8]) recordTick(ms, 0);
    const s = getTickStats();
    expect(s.p50Ms).toBeGreaterThan(0);
    expect(s.p50Ms).toBeLessThan(1);
  });

  it('evicts old samples once the window is full', () => {
    // Fill the 600-tick window with slow ticks, then overwrite it with fast
    // ones: the slow ticks must fall out entirely.
    for (let i = 0; i < 600; i++) recordTick(500, 0);
    expect(getTickStats().maxMs).toBe(500);

    for (let i = 0; i < 600; i++) recordTick(1, 0);
    const s = getTickStats();
    expect(s.samples).toBe(600);
    expect(s.maxMs).toBe(1);
    expect(s.p99Ms).toBe(1);
  });

  it('tracks queue-size percentiles alongside duration', () => {
    for (let i = 1; i <= 100; i++) recordTick(1, i);
    const s = getTickStats();
    expect(s.p95QueueSize).toBe(95);
    expect(s.maxQueueSize).toBe(100);
  });

  it('counts total and catch-up ticks', () => {
    recordTick(1, 0);
    recordTick(1, 0);
    recordCatchUpTick();
    const s = getTickStats();
    expect(s.totalTicks).toBe(2);
    expect(s.catchUpTicks).toBe(1);
  });
});

describe('getLastTickAt', () => {
  it('is 0 before the loop starts and set afterwards', () => {
    expect(getLastTickAt()).toBe(0);
    recordTick(1, 0);
    expect(getLastTickAt()).toBeGreaterThan(0);
  });
});
