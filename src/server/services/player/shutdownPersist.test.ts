/**
 * Shutdown persistence: what survives a failed write, not throughput. One
 * rejection must not cost the players saved after it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PlayerServer } from '../../../shared/types.js';

const save = vi.fn();
vi.mock('../../persistence/playerRepository.js', () => ({
  playerRepository: {
    save: (...args: unknown[]) => save(...args),
  },
}));

const { persistPlayersOnShutdown } = await import('./playerService.js');

function mkPlayers(n: number): PlayerServer[] {
  return Array.from(
    { length: n },
    (_, i) =>
      ({
        id: `p${i}`,
        name: `Player${i}`,
        mapId: '1',
        position: { x: 0, y: 0 },
      }) as PlayerServer,
  );
}

beforeEach(() => {
  save.mockReset();
  // What the repository answers when the write landed: false is a write the
  // presence fence refused, and it is not what this file is about.
  save.mockResolvedValue(true);
});

describe('persistPlayersOnShutdown', () => {
  it('persists every player', async () => {
    const result = await persistPlayersOnShutdown(mkPlayers(5));

    expect(save).toHaveBeenCalledTimes(5);
    expect(result).toEqual({ saved: 5, failed: 0 });
  });

  it('keeps saving the rest after one write rejects', async () => {
    save.mockImplementation((p: { name: string }) =>
      p.name === 'Player2'
        ? Promise.reject(new Error('write conflict'))
        : Promise.resolve(true),
    );

    const result = await persistPlayersOnShutdown(mkPlayers(5));

    expect(save).toHaveBeenCalledTimes(5);
    expect(result).toEqual({ saved: 4, failed: 1 });
  });

  it('reports how many were lost when every write fails', async () => {
    save.mockRejectedValue(new Error('db is gone'));

    const result = await persistPlayersOnShutdown(mkPlayers(3));

    expect(result).toEqual({ saved: 0, failed: 3 });
  });

  it('never resolves with an unhandled rejection escaping', async () => {
    save.mockRejectedValue(new Error('boom'));
    await expect(persistPlayersOnShutdown(mkPlayers(4))).resolves.toBeDefined();
  });

  it('holds concurrency at the limit instead of dispatching everything at once', async () => {
    let inFlight = 0;
    let peak = 0;
    save.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return true;
    });

    await persistPlayersOnShutdown(mkPlayers(50), 4);

    expect(peak).toBe(4);
    expect(save).toHaveBeenCalledTimes(50);
  });

  it('does not spawn more workers than there are players', async () => {
    let peak = 0;
    let inFlight = 0;
    save.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return true;
    });

    await persistPlayersOnShutdown(mkPlayers(2), 32);

    expect(peak).toBe(2);
  });

  it('handles an empty server', async () => {
    const result = await persistPlayersOnShutdown([]);
    expect(result).toEqual({ saved: 0, failed: 0 });
    expect(save).not.toHaveBeenCalled();
  });

  it('runs in parallel, not one round trip after another', async () => {
    save.mockImplementation(
      () => new Promise((r) => setTimeout(() => r(true), 20)),
    );

    const started = Date.now();
    await persistPlayersOnShutdown(mkPlayers(16), 16);
    const elapsed = Date.now() - started;

    // Sequentially this is 16 x 20ms = 320ms. Generous bound so a slow CI box
    // cannot flake it, while still failing if the writes serialize.
    expect(elapsed).toBeLessThan(150);
  });
});
