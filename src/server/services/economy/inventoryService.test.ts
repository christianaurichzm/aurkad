import { describe, it, expect, afterEach, vi } from 'vitest';
import { createFixture } from '../../sim/simFixture.js';
import type { Item, PlayerServer } from '../../../shared/types.js';
import { clearAll, on } from '../../engine/hooks.js';
import ItemModel from '../../model/Item.js';
import DeliveryModel from '../../model/Delivery.js';
import { countItem } from './economyService.js';
import {
  deleteItem,
  dropItemFromInventory,
  equipItem,
  unequipItem,
} from './inventoryService.js';

const item = (id: number, overrides: Partial<Item> = {}): Item => ({
  id,
  name: `Item${id}`,
  description: '',
  sprite: 0,
  type: 'weapon',
  ...overrides,
});

describe('bound items', () => {
  it('cannot be dropped; unbound items can', () => {
    const sim = createFixture(0);
    sim.addItem(item(50, { bound: true }));
    sim.addItem(item(51));
    const alice = sim.addPlayer({
      name: 'Alice',
      inventory: {
        items: [
          { item: 50, quantity: 1 },
          { item: 51, quantity: 1 },
        ],
        maxCapacity: 10,
      },
    });

    expect(dropItemFromInventory('Alice', 50)).toBe(false);
    expect(alice.inventory.items.find((e) => e.item === 50)?.quantity).toBe(1);
    expect(sim.map.droppedItems).toHaveLength(0);

    expect(dropItemFromInventory('Alice', 51)).toBe(true);
    expect(alice.inventory.items.find((e) => e.item === 51)).toBeUndefined();
    expect(sim.map.droppedItems).toHaveLength(1);
  });

  it('refuse to unequip into a full inventory instead of hitting the ground', () => {
    const sim = createFixture(0);
    sim.addItem(item(50, { bound: true }));
    for (let i = 0; i < 10; i++) {
      sim.addItem(item(100 + i, { type: 'consumable' }));
    }
    const alice = sim.addPlayer({
      name: 'Alice',
      inventory: {
        items: Array.from({ length: 10 }, (_, i) => ({
          item: 100 + i,
          quantity: 1,
        })),
        maxCapacity: 10,
      },
      equipped: { weapon: 50 },
    });

    unequipItem(alice, 'weapon');

    expect(alice.equipped.weapon).toBe(50);
    expect(sim.map.droppedItems).toHaveLength(0);
    expect(alice.inventory.items).toHaveLength(10);
  });

  it('unequip normally when there is inventory space', () => {
    const sim = createFixture(0);
    sim.addItem(item(50, { bound: true }));
    const alice = sim.addPlayer({
      name: 'Alice',
      inventory: { items: [], maxCapacity: 10 },
      equipped: { weapon: 50 },
    });

    unequipItem(alice, 'weapon');

    expect(alice.equipped.weapon).toBeUndefined();
    expect(alice.inventory.items).toEqual([{ item: 50, quantity: 1 }]);
  });

  it('equipping a replacement never destroys an equipped bound item', () => {
    const sim = createFixture(0);
    sim.addItem(item(50, { bound: true }));
    sim.addItem(item(60));
    for (let i = 0; i < 9; i++) {
      sim.addItem(item(100 + i, { type: 'consumable' }));
    }
    const alice = sim.addPlayer({
      name: 'Alice',
      inventory: {
        items: [
          ...Array.from({ length: 9 }, (_, i) => ({
            item: 100 + i,
            quantity: 1,
          })),
          // Two of them: taking one off the stack opens no slot for the bound
          // piece to go to.
          { item: 60, quantity: 2 },
        ],
        maxCapacity: 10,
      },
      equipped: { weapon: 50 },
    });

    equipItem(alice, 60);

    expect(alice.equipped.weapon).toBe(50);
    expect(alice.inventory.items.find((e) => e.item === 60)?.quantity).toBe(2);
    expect(sim.map.droppedItems).toHaveLength(0);
  });
});

describe('equipping over a worn item with a full bag', () => {
  afterEach(() => clearAll());

  /**
   * Alice wearing item 50 (+5 attack) with all ten slots taken: nine fillers
   * and `quantity` of item 60 (+3 attack).
   */
  const fullBag = (quantity: number, worn: Partial<Item> = {}) => {
    const sim = createFixture(0);
    sim.addItem(
      item(50, {
        effects: [{ attribute: 'attack', type: 'add', value: 5 }],
        ...worn,
      }),
    );
    sim.addItem(
      item(60, { effects: [{ attribute: 'attack', type: 'add', value: 3 }] }),
    );
    const fillers = Array.from({ length: 9 }, (_, i) => ({
      item: 100 + i,
      quantity: 1,
    }));
    for (const filler of fillers) {
      sim.addItem(item(filler.item, { type: 'consumable' }));
    }
    const alice = sim.addPlayer({
      name: 'Alice',
      attack: 15,
      inventory: {
        items: [...fillers, { item: 60, quantity }],
        maxCapacity: 10,
      },
      equipped: { weapon: 50 },
    });
    return { sim, alice };
  };

  it('puts the old piece in the slot a lone new piece leaves', () => {
    const { sim, alice } = fullBag(1);

    equipItem(alice, 60);

    expect(alice.equipped.weapon).toBe(60);
    expect(countItem(alice.inventory, 50)).toBe(1);
    expect(countItem(alice.inventory, 60)).toBe(0);
    expect(alice.inventory.items).toHaveLength(10);
    expect(sim.map.droppedItems).toHaveLength(0);
    expect(alice.attack).toBe(13);
    expect(alice.equippedEffects?.weapon).toEqual([
      { attribute: 'attack', type: 'add', value: 3 },
    ]);
  });

  it('swaps a bound old piece the same way instead of refusing', () => {
    const { sim, alice } = fullBag(1, { bound: true });

    equipItem(alice, 60);

    expect(alice.equipped.weapon).toBe(60);
    expect(countItem(alice.inventory, 50)).toBe(1);
    expect(countItem(alice.inventory, 60)).toBe(0);
    expect(alice.inventory.items).toHaveLength(10);
    expect(sim.map.droppedItems).toHaveLength(0);
  });

  it('drops the old piece when the new one comes off a stack', () => {
    const { sim, alice } = fullBag(2);

    equipItem(alice, 60);

    expect(alice.equipped.weapon).toBe(60);
    expect(countItem(alice.inventory, 50)).toBe(0);
    expect(countItem(alice.inventory, 60)).toBe(1);
    expect(alice.inventory.items).toHaveLength(10);
    expect(sim.map.droppedItems).toEqual([
      { itemId: 50, sprite: 0, position: alice.position, quantity: 1 },
    ]);
  });

  it('shows each hook the state it announces', () => {
    const { alice } = fullBag(1);
    const seen: unknown[] = [];
    const look = ({ player }: { player: PlayerServer }) =>
      seen.push({
        worn: player.equipped.weapon,
        attack: player.attack,
        old: countItem(player.inventory, 50),
        new: countItem(player.inventory, 60),
      });
    on('itemUnequip', look);
    on('itemEquip', look);

    equipItem(alice, 60);

    expect(seen).toEqual([
      { worn: undefined, attack: 10, old: 1, new: 0 },
      { worn: 60, attack: 13, old: 1, new: 0 },
    ]);
  });
});

describe('equipment effects', () => {
  afterEach(() => vi.restoreAllMocks());

  it('come off when an item deleted from the catalogue is replaced', async () => {
    vi.spyOn(ItemModel, 'deleteOne').mockResolvedValue(null as never);
    vi.spyOn(DeliveryModel, 'deleteMany').mockResolvedValue({
      deletedCount: 0,
    } as never);
    const sim = createFixture(0);
    sim.addItem(
      item(50, { effects: [{ attribute: 'attack', type: 'add', value: 10 }] }),
    );
    sim.addItem(item(60));
    const alice = sim.addPlayer({
      name: 'Alice',
      attack: 5,
      inventory: {
        items: [
          { item: 50, quantity: 1 },
          { item: 60, quantity: 1 },
        ],
        maxCapacity: 10,
      },
    });
    equipItem(alice, 50);
    expect(alice.attack).toBe(15);

    await deleteItem(50);
    equipItem(alice, 60);

    expect(alice.attack).toBe(5);
  });
});
