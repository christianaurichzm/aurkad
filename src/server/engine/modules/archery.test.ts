// Exercises the real archery module: shooting hits the enemy you face and emits
// a projectile:fire event; a miss still fires the visual; cooldown limits rate.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadModules, unloadAllModules } from './moduleLoader.js';
import { clearProvides } from './registry.js';
import { clearCommands } from '../commands.js';
import { clearAll } from '../hooks.js';
import { drainGameEvents } from '../eventBus.js';
import { handleCustomAction } from '../../services/customEventService.js';
import { createFixture, tile } from '../../sim/simFixture.js';
import { Direction } from '../../../shared/types.js';

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
  loadModules(); // real modules/ (archery enabled in game.json)
});

afterEach(() => {
  unloadAllModules();
  clearAll();
  clearProvides();
});

describe('archery module', () => {
  it('hits the enemy you face and fires the arrow', () => {
    const sim = createFixture(0);
    sim.addPlayer({
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
    sim.step(1); // build the spatial index
    drainGameEvents();

    shoot('Alice');

    expect(enemy.health).toBeLessThan(30);
    expect(firedProjectile()).toBeDefined();
  });

  it('a miss still fires the arrow visual', () => {
    const sim = createFixture(0);
    sim.addPlayer({
      name: 'Alice',
      position: tile(5, 5),
      direction: Direction.Right,
    });
    sim.step(1);
    drainGameEvents();

    shoot('Alice');

    expect(firedProjectile()).toBeDefined();
  });

  it('respects the cooldown', () => {
    const sim = createFixture(0);
    sim.addPlayer({
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
    sim.step(1);

    shoot('Alice');
    const afterFirst = enemy.health;
    shoot('Alice'); // immediately again - on cooldown

    expect(enemy.health).toBe(afterFirst); // no second hit
  });
});
