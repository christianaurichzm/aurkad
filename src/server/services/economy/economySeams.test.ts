/**
 * The seams, through the real paths: economyService has its own unit tests,
 * and these check the callers go through it rather than doing their own
 * capacity arithmetic and missing a swallowed operation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runInSandbox } from '../../engine/scripting/sandbox.js';
import { clearAll, emit } from '../../engine/hooks.js';
import { createFixture } from '../../sim/simFixture.js';
import { buyShopItem } from './shopService.js';
import { countItem } from './economyService.js';
import type {
  Item,
  PlayerServer,
  Shop,
  ProductRaw,
} from '../../../shared/types.js';

vi.mock('../player/playerService.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, persistPlayersNow: vi.fn() };
});

const results = vi.hoisted(() => ({ log: [] as unknown[] }));

beforeEach(() => {
  clearAll();
  results.log = [];
});

function withItems() {
  const sim = createFixture(0);
  const define = (id: number, name: string, type = 'money'): Item =>
    ({ id, name, description: '', sprite: 0, type }) as Item;
  sim.addItem(define(1, 'Gold'));
  sim.addItem(define(2, 'Sword', 'weapon'));
  sim.addItem(define(3, 'Shield', 'chestplate'));
  return sim;
}

/** Runs a script with a `record()` global so it can report return values. */
function script(code: string) {
  return runInSandbox(code, 'economy.js', {
    record: (value: unknown) => results.log.push(value),
  });
}

describe('giveItem from a script', () => {
  it('reports false instead of silently swallowing the item', () => {
    const sim = withItems();
    const player = sim.addPlayer({
      name: 'Alice',
      inventory: { items: [{ item: 2, quantity: 1 }], maxCapacity: 1 },
    });
    const handle = script(
      `on('playerJoin', ({ player }) => record(giveItem(player, 1, 5)));`,
    );

    emit('playerJoin', { player });

    expect(results.log).toEqual([false]);
    expect(countItem(player.inventory, 1)).toBe(0);
    handle.cleanup();
  });

  it('reports true when it lands', () => {
    const sim = withItems();
    const player = sim.addPlayer({ name: 'Alice' });
    const handle = script(
      `on('playerJoin', ({ player }) => record(giveItem(player, 1, 5)));`,
    );

    emit('playerJoin', { player });

    expect(results.log).toEqual([true]);
    expect(countItem(player.inventory, 1)).toBe(5);
    handle.cleanup();
  });

  // An id no item defines, let into the inventory, throws while building the
  // stats payload and leaves that player without stat updates until logout.
  it('refuses an item id that does not exist', () => {
    const sim = withItems();
    const player = sim.addPlayer({ name: 'Alice' });
    const handle = script(
      `on('playerJoin', ({ player }) => record(giveItem(player, 9999, 1)));`,
    );

    emit('playerJoin', { player });

    expect(results.log).toEqual([false]);
    expect(player.inventory.items).toEqual([]);
    handle.cleanup();
  });
});

describe('removeItem from a script', () => {
  // Asking for more than the player has takes nothing: subtracting anyway
  // would go negative, delete the slot and destroy the rest.
  it('takes nothing and reports false when the player is short', () => {
    const sim = withItems();
    const player = sim.addPlayer({
      name: 'Alice',
      inventory: { items: [{ item: 1, quantity: 2 }], maxCapacity: 10 },
    });
    const handle = script(
      `on('playerJoin', ({ player }) => record(removeItem(player, 1, 5)));`,
    );

    emit('playerJoin', { player });

    expect(results.log).toEqual([false]);
    expect(countItem(player.inventory, 1)).toBe(2);
    handle.cleanup();
  });

  it('takes the exact amount and reports true', () => {
    const sim = withItems();
    const player = sim.addPlayer({
      name: 'Alice',
      inventory: { items: [{ item: 1, quantity: 5 }], maxCapacity: 10 },
    });
    const handle = script(
      `on('playerJoin', ({ player }) => record(removeItem(player, 1, 5)));`,
    );

    emit('playerJoin', { player });

    expect(results.log).toEqual([true]);
    expect(player.inventory.items).toEqual([]);
    handle.cleanup();
  });
});

describe('moveItem from a script', () => {
  it('moves between a player inventory and any other container', () => {
    const sim = withItems();
    const player = sim.addPlayer({
      name: 'Alice',
      inventory: { items: [{ item: 1, quantity: 10 }], maxCapacity: 10 },
    });
    const handle = script(`
      on('playerJoin', ({ player }) => {
        const bank = { items: [], maxCapacity: 5 };
        record(moveItem(player.inventory, bank, 1, 4).ok);
        record(bank.items[0].quantity);
        record(countItem(player, 1));
      });
    `);

    emit('playerJoin', { player });

    expect(results.log).toEqual([true, 4, 6]);
    handle.cleanup();
  });

  it('leaves the source untouched when the destination is full', () => {
    const sim = withItems();
    const player = sim.addPlayer({
      name: 'Alice',
      inventory: { items: [{ item: 1, quantity: 10 }], maxCapacity: 10 },
    });
    const handle = script(`
      on('playerJoin', ({ player }) => {
        const full = { items: [{ item: 2, quantity: 1 }], maxCapacity: 1 };
        const moved = moveItem(player.inventory, full, 1, 4);
        record(moved.ok);
        record(moved.reason);
        record(countItem(player, 1));
      });
    `);

    emit('playerJoin', { player });

    expect(results.log).toEqual([false, 'no-space', 10]);
    handle.cleanup();
  });
});

describe('buying from a shop', () => {
  const shop = (price: number): Shop<ProductRaw> => ({
    id: 'general',
    name: 'General',
    products: [{ itemId: 2, currency: 1, price }],
  });

  function buyer(inventory: PlayerServer['inventory']) {
    const sim = withItems();
    return sim.addPlayer({ name: 'Alice', inventory });
  }

  it('charges and delivers', async () => {
    const player = buyer({
      items: [{ item: 1, quantity: 50 }],
      maxCapacity: 10,
    });

    expect(await buyShopItem(player, 2, shop(10))).toBe(true);

    expect(countItem(player.inventory, 1)).toBe(40);
    expect(countItem(player.inventory, 2)).toBe(1);
  });

  it('does not charge when the player cannot afford it', async () => {
    const player = buyer({
      items: [{ item: 1, quantity: 5 }],
      maxCapacity: 10,
    });

    expect(await buyShopItem(player, 2, shop(10))).toBe(false);

    expect(countItem(player.inventory, 1)).toBe(5);
    expect(countItem(player.inventory, 2)).toBe(0);
  });

  // The half-apply this rules out: currency spent, item never delivered.
  it('does not charge when the inventory has no room for the item', async () => {
    const player = buyer({
      items: [
        { item: 1, quantity: 50 },
        { item: 3, quantity: 1 },
      ],
      maxCapacity: 2,
    });

    expect(await buyShopItem(player, 2, shop(10))).toBe(false);

    expect(countItem(player.inventory, 1)).toBe(50);
    expect(countItem(player.inventory, 2)).toBe(0);
  });

  it('still sells when the item is already held and the bag is full', async () => {
    const player = buyer({
      items: [
        { item: 1, quantity: 50 },
        { item: 2, quantity: 1 },
      ],
      maxCapacity: 2,
    });

    expect(await buyShopItem(player, 2, shop(10))).toBe(true);

    expect(countItem(player.inventory, 2)).toBe(2);
  });
});
