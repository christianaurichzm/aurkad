import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetClock, advanceTick } from './clock.js';
import {
  scheduleAfter,
  scheduleEvery,
  cancelScheduled,
  runScheduledTasks,
  resetScheduler,
  scheduledTaskCount,
} from './scheduler.js';

// One simulated tick: advance the clock, then drain what is due.
function tick(times = 1) {
  for (let i = 0; i < times; i++) {
    advanceTick();
    runScheduledTasks();
  }
}

describe('scheduler', () => {
  beforeEach(() => {
    resetClock();
    resetScheduler();
  });

  describe('after', () => {
    it('runs once on the target tick, not before', () => {
      const fn = vi.fn();
      scheduleAfter(3, fn);

      tick(2);
      expect(fn).not.toHaveBeenCalled();
      tick();
      expect(fn).toHaveBeenCalledTimes(1);
      tick(5);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retires itself so it stops occupying the queue', () => {
      scheduleAfter(1, () => {});
      expect(scheduledTaskCount()).toBe(1);
      tick();
      expect(scheduledTaskCount()).toBe(0);
    });

    it('runs on the next tick when scheduled with 0', () => {
      const fn = vi.fn();
      scheduleAfter(0, fn);
      tick();
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('treats a negative or non-finite delay as the next tick', () => {
      const fn = vi.fn();
      scheduleAfter(-5, fn);
      scheduleAfter(Number.NaN, fn);
      tick();
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('every', () => {
    it('repeats on its interval', () => {
      const fn = vi.fn();
      scheduleEvery(2, fn);

      tick(2);
      expect(fn).toHaveBeenCalledTimes(1);
      tick(2);
      expect(fn).toHaveBeenCalledTimes(2);
      tick(4);
      expect(fn).toHaveBeenCalledTimes(4);
    });

    it('fires at most once per tick, even with interval 0', () => {
      const fn = vi.fn();
      scheduleEvery(0, fn);
      tick();
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('cancellation', () => {
    it('cancels a pending one-shot', () => {
      const fn = vi.fn();
      const id = scheduleAfter(2, fn);
      cancelScheduled(id);
      tick(5);
      expect(fn).not.toHaveBeenCalled();
    });

    it('cancels a repeating task mid-flight', () => {
      const fn = vi.fn();
      const id = scheduleEvery(1, fn);
      tick(2);
      expect(fn).toHaveBeenCalledTimes(2);
      cancelScheduled(id);
      tick(3);
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('lets a task cancel itself from inside its own callback', () => {
      const fn = vi.fn();
      let id = 0;
      id = scheduleEvery(1, () => {
        fn();
        cancelScheduled(id);
      });
      tick(3);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('does not run a task another one cancelled earlier in the same tick', () => {
      const cancelled = vi.fn();
      let id = 0;
      scheduleAfter(1, () => cancelScheduled(id));
      id = scheduleAfter(1, cancelled);
      tick();
      expect(cancelled).not.toHaveBeenCalled();
    });
  });

  describe('isolation', () => {
    it('keeps running other tasks when one throws', () => {
      const ok = vi.fn();
      scheduleAfter(1, () => {
        throw new Error('boom');
      });
      scheduleAfter(1, ok);

      expect(() => tick()).not.toThrow();
      expect(ok).toHaveBeenCalledTimes(1);
    });

    it('re-arms a throwing repeat task instead of firing it every tick', () => {
      const fn = vi.fn(() => {
        throw new Error('boom');
      });
      scheduleEvery(2, fn);

      tick(2);
      expect(fn).toHaveBeenCalledTimes(1);
      tick();
      expect(fn).toHaveBeenCalledTimes(1);
      tick();
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('does not run a task scheduled during this same tick drain', () => {
      const inner = vi.fn();
      scheduleAfter(1, () => {
        scheduleAfter(0, inner);
      });

      tick();
      expect(inner).not.toHaveBeenCalled();
      tick();
      expect(inner).toHaveBeenCalledTimes(1);
    });
  });

  it('runs a task that came due while nothing drained the queue', () => {
    const fn = vi.fn();
    scheduleAfter(1, fn);
    // Clock jumps ahead (catch-up ticks) without a drain in between.
    advanceTick();
    advanceTick();
    advanceTick();
    runScheduledTasks();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('reset clears pending work', () => {
    const fn = vi.fn();
    scheduleEvery(1, fn);
    resetScheduler();
    tick(3);
    expect(fn).not.toHaveBeenCalled();
    expect(scheduledTaskCount()).toBe(0);
  });
});
