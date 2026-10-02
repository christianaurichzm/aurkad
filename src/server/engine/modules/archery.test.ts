// Exercises the real archery module via the tick loop.
// Damage is applied only when the projectile physically reaches an entity
// (checked each server tick), so tests advance ticks with sim.step().
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unloadAllModules } from './moduleLoader.js';
import { loadModulesForTest } from '../../../test/modules.js';
import { clearProvides } from './registry.js';
import { clearCommands } from '../commands.js';
import { clearAll } from '../hooks.js';
import { drainGameEvents } from '../eventBus.js';
import { handleCustomAction } from '../../services/comms/customEventService.js';
import { createFixture, tile } from '../../sim/simFixture.js';
import { Direction } from '../../../shared/types.js';
import { TILE_SIZE } from '../../../shared/constants.js';
import { items } from '../../services/world/gameData.js';
import {
  registerArrow,
  unregisterArrow,
} from '../../services/content/arrowService.js';
import type { PlayerServer } from '../../../shared/types.js';

const TEST_ARROW_ID = 999;
const TEST_ITEM_ID = 999;

// Registers a minimal arrow + a weapon item that references it, and equips the
// weapon on the given player so getEquippedArrow() returns the test arrow.
function equipTestArrow(player: PlayerServer): void {
  registerArrow({
    id: TEST_ARROW_ID,
    name: 'Test Arrow',
    description: '',
    sprite: 0,
    damage: 8,
  });
  items.set(TEST_ITEM_ID, {
    id: TEST_ITEM_ID,
    name: 'Test Bow',
    description: '',
    sprite: 0,
    type: 'weapon',
    arrowId: TEST_ARROW_ID,
  });
  player.equipped = { ...player.equipped, weapon: TEST_ITEM_ID };
}

function cleanupTestArrow(): void {
  unregisterArrow(TEST_ARROW_ID);
  items.delete(TEST_ITEM_ID);
}

const shoot = (username: string) =>
  handleCustomAction({ type: 'custom', username, channel: 'shoot' });

const firedProjectile = () =>
  drainGameEvents().find(
    (e) => e.type === 'customMap' && e.channel === 'projectile:fire',
  );

beforeEach(() => {
  clearAll();
  clearCommands();
  clearProvides();
  drainGameEvents();
  loadModulesForTest('archery');
});

afterEach(() => {
  cleanupTestArrow();
  unloadAllModules();
  clearAll();
  clearProvides();
});

describe('archery module', () => {
  it('does not fire without a ranged weapon equipped', () => {
    const sim = createFixture(0);
    sim.addPlayer({
      name: 'Alice',
      position: tile(5, 5),
      direction: Direction.Right,
    });
    sim.step(1);
    drainGameEvents();

    shoot('Alice'); // no weapon equipped

    expect(firedProjectile()).toBeUndefined();
  });

  it('fires the projectile immediately and damages target on arrival', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({
      name: 'Alice',
      position: tile(5, 5),
      direction: Direction.Right,
    });
    const enemy = sim.addNpc({
      name: 'Goblin',
      behavior: 'aggressive',
      attack: 0,
      position: tile(8, 5),
      maxHealth: 30,
      health: 30,
    });
    equipTestArrow(alice);
    sim.step(1);
    drainGameEvents();

    shoot('Alice');

    expect(firedProjectile()).toBeDefined(); // projectile event fires immediately
    expect(enemy.health).toBe(30); // no damage yet

    sim.step(10); // let projectile travel (3 tiles at 8t/s ≈ 7 ticks at 20Hz)

    expect(enemy.health).toBeLessThan(30);
  });

  it('lands in the middle of an npc three tiles wide, where the arrow is drawn landing', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({
      name: 'Alice',
      position: tile(13, 8),
      direction: Direction.Left,
    });
    // Footprint cols 8-10, rows 7-9: its middle is (9,8), its near side x=704.
    const boss = sim.addNpc({
      behavior: 'aggressive',
      sight: 0,
      position: tile(8, 7),
      width: 3 * TILE_SIZE,
      height: 3 * TILE_SIZE,
      maxHealth: 30,
      health: 30,
    });
    equipTestArrow(alice);
    sim.step(1);
    drainGameEvents();

    shoot('Alice');
    const fired = firedProjectile();
    expect(fired?.type === 'customMap' && fired.payload).toMatchObject({
      toX: 9 * TILE_SIZE + TILE_SIZE / 2,
      toY: 8 * TILE_SIZE + TILE_SIZE / 2,
    });

    // 8 tiles a second: past its near side in 7 ticks, in its middle in 10.
    sim.step(7);
    expect(boss.health).toBe(30);
    sim.step(3);
    expect(boss.health).toBeLessThan(30);
  });

  it('a miss fires the arrow visual and causes no damage', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({
      name: 'Alice',
      position: tile(5, 5),
      direction: Direction.Right,
    });
    equipTestArrow(alice);
    sim.step(1);
    drainGameEvents();

    shoot('Alice');

    expect(firedProjectile()).toBeDefined();
    sim.step(10); // projectile expires at end of range - no crash
  });

  it('hits an entity that enters the path after the shot is fired', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({
      name: 'Alice',
      position: tile(5, 5),
      direction: Direction.Right,
    });
    // Enemy starts below arrow row (dx=0 facing Right → not "in front").
    const enemy = sim.addNpc({
      name: 'Goblin',
      behavior: 'aggressive',
      attack: 0,
      position: tile(5, 8),
      maxHealth: 30,
      health: 30,
    });
    equipTestArrow(alice);
    sim.step(1);
    drainGameEvents();

    shoot('Alice'); // no target in front → miss shot along player's row
    expect(firedProjectile()).toBeDefined();
    expect(enemy.health).toBe(30);

    // Reposition enemy onto the arrow's horizontal path mid-flight.
    // The quadtree is rebuilt from current entity positions each tick,
    // so the collision check picks up the new position immediately.
    enemy.position = tile(7, 5);

    sim.step(10); // projectile reaches tile(7,5) within ~4 ticks and hits

    expect(enemy.health).toBeLessThan(30);
  });

  it('respects the cooldown between shots', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({
      name: 'Alice',
      position: tile(5, 5),
      direction: Direction.Right,
    });
    const enemy = sim.addNpc({
      name: 'Goblin',
      behavior: 'aggressive',
      attack: 0,
      position: tile(8, 5),
      maxHealth: 30,
      health: 30,
    });
    equipTestArrow(alice);
    sim.step(1);

    shoot('Alice');
    shoot('Alice'); // blocked - still on cooldown

    const events = drainGameEvents().filter(
      (e) => e.type === 'customMap' && e.channel === 'projectile:fire',
    );
    expect(events).toHaveLength(1);

    // 15 ticks: the arrow lands (~7) and the cooldown expires (~12 at 20Hz)
    sim.step(15);
    expect(enemy.health).toBeLessThan(30);

    const healthAfterFirst = enemy.health;

    shoot('Alice'); // cooldown expired - fires again
    expect(firedProjectile()).toBeDefined();

    sim.step(10);
    expect(enemy.health).toBeLessThan(healthAfterFirst);
  });
});
