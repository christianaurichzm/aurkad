import { describe, it, expect } from 'vitest';
import {
  nsCountPlayer,
  nsCountDeferred,
  nsCountBytes,
  nsCountWorldUpdate,
  nsCountEntityLeave,
  nsCountChunk,
  nsFlushTick,
  getNetStats,
} from './netStats.js';

// Module-level circular buffer with no reset hook, so the order below is the
// test: the empty case has to be asserted before anything is recorded.
describe('netStats', () => {
  it('says so instead of dividing by zero before the first tick', () => {
    expect(getNetStats()).toEqual({ windowTicks: 0, note: 'no data yet' });
  });

  it('reports zero rather than NaN for a tick with no traffic', () => {
    nsFlushTick();
    const s = getNetStats() as Record<string, Record<string, number>>;
    expect(s.bandwidth!.avgBytesPerPlayerPerTick).toBe(0);
    expect(s.dynamicSnapshots!.deltaRatioPercent).toBe(0);
    expect(s.dynamicSnapshots!.avgDeltaSizeBytes).toBe(0);
    expect(s.entityLeave!.avgEntitiesPerMessage).toBe(0);
    expect(s.mapChunks!.avgBytesPerChunk).toBe(0);
  });

  it('averages over the ticks flushed so far', () => {
    nsCountPlayer();
    nsCountPlayer();
    nsCountDeferred();
    nsCountBytes(300);
    nsCountWorldUpdate(200, 1, 3);
    nsCountEntityLeave(2, 50);
    nsCountChunk(100);
    nsFlushTick(); // the window also holds the idle tick above, so n is 2

    const s = getNetStats() as Record<string, Record<string, number>>;
    expect(s.windowTicks).toBe(2);
    expect(s.windowSeconds).toBe(0.1);
    expect(s.players).toEqual({ avgPerTick: 1, avgDeferredPerTick: 0.5 });
    // 300 counted directly + 50 from the leave message + 100 from the chunk
    expect(s.bandwidth).toEqual({
      avgBytesPerTick: 225,
      avgBytesPerPlayerPerTick: 225,
      totalBytes: 450,
    });
    expect(s.dynamicSnapshots).toMatchObject({
      worldUpdates: 1,
      fullGameStates: 1,
      deltas: 3,
      deltaRatioPercent: 75,
      avgDeltaSizeBytes: 200,
    });
    expect(s.entityLeave).toEqual({
      totalMessages: 1,
      totalEntities: 2,
      avgEntitiesPerMessage: 2,
    });
    expect(s.mapChunks).toEqual({ totalDelivered: 1, avgBytesPerChunk: 100 });
  });

  it('drops the oldest tick once the window is full', () => {
    for (let i = 0; i < 200; i++) {
      nsCountBytes(7);
      nsFlushTick();
    }

    const s = getNetStats() as Record<string, Record<string, number>>;
    expect(s.windowTicks).toBe(100);
    expect(s.bandwidth!.totalBytes).toBe(700); // the last 100 ticks, not all 203
  });
});
