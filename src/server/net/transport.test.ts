import { describe, it, expect, beforeEach } from 'vitest';
import { ServerActionType } from '../engine/actions.js';
import { gameConfig } from '../gameConfig.js';
import { advanceTick } from '../sim/clock.js';
import { createFixture, tile } from '../sim/simFixture.js';
import { rebuildQuadtree } from '../spatial/spatialManager.js';
import {
  enqueueServerAction,
  getActionQueueSize,
  processActions,
  rateLimiterEntryCount,
} from './transport.js';

// The queue is a module singleton, so every test drains it before asserting.
let fx: ReturnType<typeof createFixture>;

beforeEach(() => {
  fx = createFixture();
  processActions();
});

describe('processActions', () => {
  it('drains everything it was given', () => {
    enqueueServerAction(ServerActionType.RegeneratePlayersHP);
    enqueueServerAction(ServerActionType.UpdateNpcPositions);
    expect(getActionQueueSize()).toBe(2);

    processActions();

    expect(getActionQueueSize()).toBe(0);
  });

  it('has no rate-limiter entry without a connection', () => {
    expect(rateLimiterEntryCount()).toBe(0);
  });
});

describe('RegeneratePlayersHP', () => {
  it('heals a hurt player by the configured share of its pool', () => {
    const { regenPercent, minRegen } = gameConfig.combat;
    const player = fx.addPlayer({ maxHealth: 1000, health: 500 });
    const expected = Math.max(Math.floor(1000 * regenPercent), minRegen);

    enqueueServerAction(ServerActionType.RegeneratePlayersHP);
    processActions();

    expect(player.health).toBe(500 + expected);
  });

  it('never heals past the pool, and leaves a full player alone', () => {
    const full = fx.addPlayer({ maxHealth: 100, health: 100 });
    const nearlyFull = fx.addPlayer({ maxHealth: 100, health: 99 });

    enqueueServerAction(ServerActionType.RegeneratePlayersHP);
    processActions();

    expect(full.health).toBe(100);
    expect(nearlyFull.health).toBe(100);
  });
});

describe('UpdateNpcPositions', () => {
  it('walks an npc whose interval is due on this tick', () => {
    fx.addPlayer({ name: 'bait', position: tile(3, 3) });
    const npc = fx.addNpc({
      behavior: 'aggressive',
      position: tile(6, 3),
      moveIntervalMs: 1,
      sight: 10,
    });
    const before = { ...npc.position };

    rebuildQuadtree(fx.map.id, fx.map); // the sight query reads the index
    enqueueServerAction(ServerActionType.UpdateNpcPositions);
    processActions();

    expect(npc.position).not.toEqual(before);
  });

  it('skips an npc whose interval has not come round yet', () => {
    fx.addPlayer({ name: 'bait', position: tile(3, 3) });
    const npc = fx.addNpc({
      behavior: 'aggressive',
      position: tile(6, 3),
      moveIntervalMs: 60_000, // 1200 ticks, so tick 1 is not a multiple
      sight: 10,
    });
    const before = { ...npc.position };

    advanceTick(); // not fx.step: the fixture drives updateNpcs itself
    rebuildQuadtree(fx.map.id, fx.map);
    enqueueServerAction(ServerActionType.UpdateNpcPositions);
    processActions();

    expect(npc.position).toEqual(before);
  });
});
