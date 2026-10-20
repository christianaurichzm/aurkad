import { spawnSync } from 'node:child_process';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { getTickStats, resetMetricsForTest } from '../metrics.js';
import { getTick, resetClock } from './clock.js';
import { flushGameEvents } from '../net/fanout.js';
import { broadcastGameState } from '../net/snapshot.js';
import { startGameLoops, WATCHDOG_SOURCE } from './loop.js';

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
  resetMetricsForTest();
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

  // Stub the monotonic clock so a test can make a timer fire late.
  function clockAt(ms: number) {
    let now = ms;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    return (to: number) => {
      now = to;
    };
  }

  // After a stall, running every due tick at once would stall the next fire.
  it('pays a short backlog back a bounded number of ticks per fire', () => {
    const max = config.gameLoop.maxUpdatesPerTick;
    const setClock = clockAt(0);
    stop = startGameLoops();

    setClock(tickMs * 4);
    vi.advanceTimersByTime(tickMs);
    expect(getTick()).toBe(Math.min(max, 4));

    for (let i = 0; i < 4; i++) vi.advanceTimersToNextTimer();
    expect(getTick()).toBe(4);
    expect(getTickStats().droppedTicks).toBe(0);
  });

  // Catching up 10s would fast-forward the world for 200 ticks.
  it('drops what a long stall owes past the backlog it pays back', () => {
    const setClock = clockAt(0);
    stop = startGameLoops();

    setClock(10_000);
    vi.advanceTimersByTime(tickMs);
    for (let i = 0; i < 20; i++) vi.advanceTimersToNextTimer();

    const owed = Math.floor(10_000 / tickMs);
    const { droppedTicks } = getTickStats();
    expect(getTick()).toBeLessThanOrEqual(Math.ceil(250 / tickMs));
    expect(getTick() + droppedTicks).toBe(owed);
  });

  // NTP may step the wall clock back; the next fire must not move that far
  // into the future with it.
  it('keeps ticking when the wall clock steps back', () => {
    stop = startGameLoops();

    vi.setSystemTime(Date.now() - 60_000);
    vi.advanceTimersByTime(tickMs * 3);

    expect(getTick()).toBe(3);
  });

  it('stops ticking once stopped', () => {
    stop = startGameLoops();
    vi.advanceTimersByTime(tickMs);
    stop();

    vi.advanceTimersByTime(tickMs * 5);

    expect(getTick()).toBe(1);
  });
});

// Runs in a child process: it blocks the main thread for good.
describe('tick watchdog', () => {
  function runChild(body: string) {
    const script = `
      const { Worker } = require('node:worker_threads');
      const heartbeat = new SharedArrayBuffer(4);
      const beat = new Int32Array(heartbeat);
      new Worker(process.env.WATCHDOG_SOURCE, {
        eval: true,
        workerData: { heartbeat, stallMs: 300, json: true },
      }).unref();
      const beating = setInterval(() => Atomics.add(beat, 0, 1), 20);
      ${body}
    `;
    return spawnSync(process.execPath, ['-e', script], {
      env: { ...process.env, WATCHDOG_SOURCE },
      encoding: 'utf8',
      timeout: 10_000,
    });
  }

  it('names where the main thread is stuck, then kills the process', () => {
    const child = runChild(`
      setTimeout(function stuckInHandler() {
        clearInterval(beating);
        for (;;) {}
      }, 300);
    `);

    expect(child.signal).toBe('SIGKILL');
    const line = JSON.parse(child.stderr.trim()) as {
      level: string;
      msg: string;
      stack: string[];
    };
    expect(line.level).toBe('error');
    expect(line.msg).toContain('stalled');
    expect(line.stack[0]).toMatch(/^stuckInHandler /);
  }, 15_000);

  it('stays quiet while the heartbeat moves', () => {
    const child = runChild(`
      setTimeout(() => clearInterval(beating), 2_200);
    `);

    expect(child.status).toBe(0);
    expect(child.stderr).toBe('');
  }, 15_000);
});
