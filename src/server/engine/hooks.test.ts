import { describe, it, expect, beforeEach } from 'vitest';
import { on, off, emit, clearAll } from './hooks.js';
import { createFixture, tile } from '../sim/simFixture.js';
import { Direction, Key } from '../../shared/types.js';
import { msToTicks } from '../sim/clock.js';
import {
  pickUpItem,
  unequipItem,
  useItem,
} from '../services/economy/inventoryService.js';
import { levelUpPlayer } from '../services/player/playerService.js';

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

  // An event reaches whoever was listening when it happened. Both halves of
  // that matter, and each is the other's regression: dispatching over the live
  // set calls a handler that subscribed mid-emit, dispatching over a plain copy
  // calls one that unsubscribed mid-emit.
  it('does not call a handler that subscribed during this emit', () => {
    const log: string[] = [];

    on('playerLevelUp', () => {
      log.push('first');
      on('playerLevelUp', () => log.push('late'));
    });

    emit('playerLevelUp', { player: {} as never, level: 2 });
    expect(log).toEqual(['first']);

    // It is listening for the next one, though.
    emit('playerLevelUp', { player: {} as never, level: 3 });
    expect(log).toEqual(['first', 'first', 'late']);
  });

  it('does not call a handler that another handler unsubscribed mid-emit', () => {
    const log: string[] = [];
    let unsubVictim = () => {};

    // Registered first, so it runs before the one it drops.
    on('playerLevelUp', () => {
      log.push('canceller');
      unsubVictim();
    });
    unsubVictim = on('playerLevelUp', () => log.push('victim'));

    emit('playerLevelUp', { player: {} as never, level: 2 });

    expect(log).toEqual(['canceller']);
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

// The seam a game replacing melee combat needs (ADR-0012): the core still owns
// damage, the module owns what a press does.
describe('playerAttack hook', () => {
  function aliceAttacksBob() {
    const sim = createFixture(0);
    sim.map.pvp = 'normal';
    sim.addPlayer({
      name: 'Alice',
      position: tile(5, 5),
      direction: Direction.Right,
      attack: 20,
    });
    const bob = sim.addPlayer({
      name: 'Bob',
      position: tile(6, 5),
      health: 100,
      maxHealth: 100,
    });

    sim.press('Alice', Key.Control);
    sim.step(1);
    return bob;
  }

  it('runs the built-in melee when nothing claims the press', () => {
    expect(aliceAttacksBob().health).toBeLessThan(100);
  });

  it('stands the melee down when a handler claims the press', () => {
    const claimed: string[] = [];
    on('playerAttack', (ctx) => {
      claimed.push(ctx.player.name);
      ctx.handled = true;
    });

    expect(aliceAttacksBob().health).toBe(100);
    expect(claimed).toEqual(['Alice']);
  });
});

describe('itemPickup hook', () => {
  it('fires when a player picks up a dropped item', () => {
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

    pickUpItem(sim.map, player);

    expect(picked).toEqual([{ itemId: 5, quantity: 3 }]);
  });
});

describe('itemUse hook', () => {
  it('fires when a player uses a consumable', () => {
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

    useItem('Alice', 9);

    expect(used).toEqual([9]);
  });
});

describe('itemEquip / itemUnequip hooks', () => {
  const weapon = (id: number, overrides = {}) => ({
    id,
    name: `Blade${id}`,
    description: '',
    sprite: 0,
    type: 'weapon' as const,
    ...overrides,
  });

  /** Both events, in order, as `slot:itemId`. */
  const record = (log: string[]) => {
    on('itemEquip', ({ itemId, slot }) => log.push(`equip:${slot}:${itemId}`));
    on('itemUnequip', ({ itemId, slot }) =>
      log.push(`unequip:${slot}:${itemId}`),
    );
  };

  it('fires when a player equips and then takes the item off', () => {
    const log: string[] = [];
    record(log);

    const sim = createFixture(0);
    sim.addItem(weapon(20));
    const player = sim.addPlayer({ name: 'Alice' });
    player.inventory.items.push({ item: 20, quantity: 1 });

    useItem('Alice', 20);
    expect(player.equipped.weapon).toBe(20);

    useItem('Alice', 20);
    expect(player.equipped.weapon).toBeUndefined();

    expect(log).toEqual(['equip:weapon:20', 'unequip:weapon:20']);
  });

  // One click, two changes to what the player is wearing: a listener that
  // recomputes from `equipped` has to see the old piece leave.
  it('fires both, unequip first, when one piece replaces another', () => {
    const log: string[] = [];
    record(log);

    const sim = createFixture(0);
    sim.addItem(weapon(20));
    sim.addItem(weapon(21));
    const player = sim.addPlayer({ name: 'Alice', equipped: { weapon: 20 } });
    player.inventory.items.push({ item: 21, quantity: 1 });

    useItem('Alice', 21);

    expect(log).toEqual(['unequip:weapon:20', 'equip:weapon:21']);
    expect(player.equipped.weapon).toBe(21);
  });

  // The refusal path: a bound item with nowhere to go stays on, so telling a
  // listener it came off would take away a bonus the player still has.
  it('stays quiet when the unequip is refused', () => {
    const log: string[] = [];
    record(log);

    const sim = createFixture(0);
    sim.addItem(weapon(20, { bound: true }));
    for (let i = 0; i < 10; i++) {
      sim.addItem({ ...weapon(100 + i), type: 'consumable' as const });
    }
    const player = sim.addPlayer({
      name: 'Alice',
      inventory: {
        items: Array.from({ length: 10 }, (_, i) => ({
          item: 100 + i,
          quantity: 1,
        })),
        maxCapacity: 10,
      },
      equipped: { weapon: 20 },
    });

    unequipItem(player, 'weapon');

    expect(player.equipped.weapon).toBe(20);
    expect(log).toEqual([]);
  });
});
