import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getFrameStats, recordFrame, resetFrameStats } from './frameProfile';

describe('frame profile', () => {
  beforeEach(() => {
    resetFrameStats();
    // The window prints one line when it fills, and these tests fill it.
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it('has nothing to say before a frame is recorded', () => {
    const { samples, frame } = getFrameStats();

    expect(samples).toBe(0);
    expect(frame).toEqual({ avgMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 });
  });

  it('reports nearest-rank percentiles, the same rule /metrics uses', () => {
    for (let i = 1; i <= 100; i++) recordFrame(i, i / 2);

    const { samples, frame, render } = getFrameStats();

    expect(samples).toBe(100);
    expect(frame).toEqual({
      avgMs: 50.5,
      p50Ms: 50,
      p95Ms: 95,
      p99Ms: 99,
      maxMs: 100,
    });
    // The render is its own series, not a share of the frame.
    expect(render.p50Ms).toBe(25);
    expect(render.maxMs).toBe(50);
  });

  it('keeps the last window and forgets what came before it', () => {
    // 600 cheap frames then 100 costly ones: the ring holds only the last 600.
    for (let i = 0; i < 600; i++) recordFrame(10, 1);
    for (let i = 0; i < 100; i++) recordFrame(50, 5);

    const { samples, frame } = getFrameStats();

    expect(samples).toBe(600);
    expect(frame.p50Ms).toBe(10);
    expect(frame.p95Ms).toBe(50);
    expect(frame.maxMs).toBe(50);
  });
});
