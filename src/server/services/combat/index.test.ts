import { describe, it, expect, beforeEach } from 'vitest';
import { gameConfig } from '../../gameConfig.js';
import { drainDirtyPlayerIds } from '../../persistence/dirtyPlayers.js';
import { advanceTick } from '../../sim/clock.js';
import { createFixture } from '../../sim/simFixture.js';
import { regenerateHealth } from './index.js';

let sim: ReturnType<typeof createFixture>;

beforeEach(() => {
  sim = createFixture(0);
});

describe('regenerateHealth', () => {
  it('heals a hurt player by the configured share of its pool', () => {
    const { regenPercent, minRegen } = gameConfig.combat;
    const player = sim.addPlayer({ maxHealth: 1000, health: 500 });
    const expected = Math.max(Math.floor(1000 * regenPercent), minRegen);

    drainDirtyPlayerIds();
    regenerateHealth();

    expect(player.health).toBe(500 + expected);
    expect(drainDirtyPlayerIds()).toEqual([player.id]);
  });

  it('never heals past the pool, and leaves a full player alone', () => {
    const full = sim.addPlayer({ maxHealth: 100, health: 100 });
    const nearlyFull = sim.addPlayer({ maxHealth: 100, health: 99 });

    regenerateHealth();

    expect(full.health).toBe(100);
    expect(nearlyFull.health).toBe(100);
  });

  it('waits for the interval between heals', () => {
    const player = sim.addPlayer({ maxHealth: 1000, health: 500 });

    advanceTick();
    regenerateHealth();

    expect(player.health).toBe(500);
  });
});
