import { describe, it, expect, beforeEach } from 'vitest';
import { on, off, clearAll } from './hooks.js';
import { createFixture, tile } from '../sim/simFixture.js';
import { Direction, Key } from '../../shared/types.js';
import { msToTicks } from '../sim/clock.js';
import { pickUpItem, useItem } from '../services/inventoryService.js';
import { levelUpPlayer } from '../services/playerService.js';

beforeEach(() => {
  clearAll();
});

// Core bus mechanics

describe('hooks bus', () => {
  it('calls registered handler when event is emitted', () => {
    const calls: string[] = [];
    on('playerLevelUp', ({ level }) => calls.push(`level:${level}`));

    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice' });
    player.experience = 100;
    levelUpPlayer(player);

    expect(calls).toEqual(['level:2']);
  });

  it('calls multiple handlers for the same event', () => {
    const log: string[] = [];
    on('playerLevelUp', () => log.push('a'));
    on('playerLevelUp', () => log.push('b'));

    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice' });
    player.experience = 100;
    levelUpPlayer(player);

    expect(log).toEqual(['a', 'b']);
  });

  it('unsubscribe returned by on() stops future calls', () => {
    const calls: number[] = [];
    const unsub = on('playerLevelUp', ({ level }) => calls.push(level));

    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice' });
    player.experience = 100;
    levelUpPlayer(player);
    expect(calls).toHaveLength(1);

    unsub();
    player.experience = player.experienceToNextLevel;
    levelUpPlayer(player);
    expect(calls).toHaveLength(1);
  });

  it('off() removes a specific handler', () => {
    const calls: number[] = [];
    const handler = ({ level }: { player: any; level: number }) =>
      calls.push(level);
    on('playerLevelUp', handler);

    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice' });
    player.experience = 100;
    levelUpPlayer(player);
    expect(calls).toHaveLength(1);

    off('playerLevelUp', handler);
    player.experience = player.experienceToNextLevel;
    levelUpPlayer(player);
    expect(calls).toHaveLength(1);
  });

  it('clearAll() removes all handlers', () => {
    const calls: number[] = [];
    on('playerLevelUp', ({ level }) => calls.push(level));
    clearAll();

    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice' });
    player.experience = 100;
    levelUpPlayer(player);

    expect(calls).toHaveLength(0);
  });

  it('emitting with no handlers is a noop', () => {
    expect(() => {
      const sim = createFixture(0);
      const player = sim.addPlayer({ name: 'Alice' });
      player.experience = 100;
      levelUpPlayer(player);
    }).not.toThrow();
  });
});

// Lifecycle events via fixture

describe('playerLevelUp hook', () => {
  it('fires with the new level each time the player levels up', () => {
    const levels: number[] = [];
    on('playerLevelUp', ({ level }) => levels.push(level));

    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice' });
    player.experience = 100;
    levelUpPlayer(player);
    player.experience = player.experienceToNextLevel;
    levelUpPlayer(player);

    expect(levels).toEqual([2, 3]);
  });
});

describe('npcDeath hook', () => {
  it('fires when a player kills an NPC', async () => {
    const events: string[] = [];
    on('npcDeath', ({ npc, killer }) =>
      events.push(`${killer.name}>${npc.name}`),
    );

    const sim = createFixture(0);
    sim.addNpc({
      name: 'Goblin',
      behavior: 'aggressive',
      maxHealth: 5,
      health: 5,
      attack: 1,
      position: tile(5, 5),
      direction: Direction.Right,
    });
    sim.addPlayer({
      name: 'Alice',
      attack: 100,
      position: tile(4, 5),
      direction: Direction.Right,
    });

    // Press attack, then step: combat is async, so microtasks flush.
    sim.press('Alice', Key.Control);
    sim.step(1);
    await Promise.resolve();

    expect(events).toEqual(['Alice>Goblin']);
  });
});

describe('playerDeath hook', () => {
  it('fires when an NPC kills a player', () => {
    const deaths: string[] = [];
    on('playerDeath', ({ player }) => deaths.push(player.name));

    const sim = createFixture(0);
    sim.addNpc({
      behavior: 'aggressive',
      attack: 9999,
      position: tile(5, 5),
      direction: Direction.Right,
    });
    sim.addPlayer({
      name: 'Alice',
      health: 1,
      position: tile(6, 5),
    });

    sim.step(msToTicks(900));

    expect(deaths).toContain('Alice');
  });
});

describe('beforeDamage hook', () => {
  it('handler can modify damage before it is applied', () => {
    on('beforeDamage', ({ damage }) => {
      damage.value = 1;
    });

    const sim = createFixture(0);
    sim.addNpc({
      behavior: 'aggressive',
      attack: 9999,
      position: tile(5, 5),
      direction: Direction.Right,
    });
    const player = sim.addPlayer({
      name: 'Alice',
      health: 100,
      maxHealth: 100,
      position: tile(6, 5),
    });

    sim.step(msToTicks(900));

    expect(player.health).toBe(99);
  });
});

describe('itemPickup hook', () => {
  it('fires when a player picks up a dropped item', async () => {
    const picked: Array<{ itemId: number; quantity: number }> = [];
    on('itemPickup', ({ itemId, quantity }) =>
      picked.push({ itemId, quantity }),
    );

    const sim = createFixture(0);
    sim.addItem({
      id: 5,
      name: 'Coin',
      description: '',
      sprite: 0,
      type: 'money',
    });
    const player = sim.addPlayer({ name: 'Alice' });
    sim.map.droppedItems.push({
      itemId: 5,
      sprite: 0,
      position: { ...player.position },
      quantity: 3,
    });

    await pickUpItem(sim.map, player);

    expect(picked).toEqual([{ itemId: 5, quantity: 3 }]);
  });
});

describe('itemUse hook', () => {
  it('fires when a player uses a consumable', async () => {
    const used: number[] = [];
    on('itemUse', ({ itemId }) => used.push(itemId));

    const sim = createFixture(0);
    sim.addItem({
      id: 9,
      name: 'Potion',
      description: '',
      sprite: 0,
      type: 'consumable',
      effects: [{ attribute: 'health', type: 'add', value: 10 }],
    });
    const player = sim.addPlayer({ name: 'Alice', health: 80, maxHealth: 100 });
    player.inventory.items.push({ item: 9, quantity: 1 });

    await useItem('Alice', 9);

    expect(used).toEqual([9]);
  });
});
