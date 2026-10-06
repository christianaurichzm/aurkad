import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { getTick, resetClock } from './clock.js';
import { flushGameEvents } from '../net/fanout.js';
import { broadcastGameState } from '../net/snapshot.js';
import { startGameLoops } from './loop.js';

// Stubs for the socket-facing systems, so a test can make one throw.
// Plain factories, because importOriginal would load loop.ts mid-factory
// and bind the real functions.
vi.mock('../net/fanout.js', () => ({ flushGameEvents: vi.fn() }));
vi.mock('../net/snapshot.js', () => ({ broadcastGameState: vi.fn() }));

const tickMs = 1000 / config.gameLoop.tickRate;
let stop: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  resetClock();
  vi.mocked(flushGameEvents).mockReset();
  vi.mocked(broadcastGameState).mockReset();
});

afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('startGameLoops', () => {
  it('runs one tick per interval', () => {
    stop = startGameLoops();
    expect(getTick()).toBe(0);

    vi.advanceTimersByTime(tickMs * 3);

    expect(getTick()).toBe(3);
    expect(broadcastGameState).toHaveBeenCalledTimes(3);
  });

  it('logs a system that throws and still runs the ones after it', () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.mocked(flushGameEvents).mockImplementation(() => {
      throw new Error('boom');
    });
    stop = startGameLoops();

    vi.advanceTimersByTime(tickMs * 2);

    expect(getTick()).toBe(2);
    expect(broadcastGameState).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith(
      '[tick] system failed: flushGameEvents',
      expect.objectContaining({ err: expect.any(Error) }),
    );
  });

  // After a stall, running every due tick at once would stall the next fire.
  it('catches up a backlog a bounded number of ticks per fire', () => {
    const max = config.gameLoop.maxUpdatesPerTick;
    stop = startGameLoops();

    // Moves the clock without firing the pending timer: the timer is late.
    vi.setSystemTime(Date.now() + tickMs * (max + 5));
    vi.advanceTimersByTime(tickMs);
    expect(getTick()).toBe(max);

    // The next fire is scheduled at once and takes the next slice.
    vi.advanceTimersToNextTimer();
    expect(getTick()).toBe(max * 2);
  });

  it('stops ticking once stopped', () => {
    stop = startGameLoops();
    vi.advanceTimersByTime(tickMs);
    stop();

    vi.advanceTimersByTime(tickMs * 5);

    expect(getTick()).toBe(1);
  });
});
