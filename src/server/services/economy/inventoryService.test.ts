import { describe, it, expect } from 'vitest';
import { createFixture } from '../../sim/simFixture.js';
import type { Item } from '../../../shared/types.js';
import {
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
  it('cannot be dropped; unbound items can', async () => {
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

    expect(await dropItemFromInventory('Alice', 50)).toBe(false);
    expect(alice.inventory.items.find((e) => e.item === 50)?.quantity).toBe(1);
    expect(sim.map.droppedItems).toHaveLength(0);

    expect(await dropItemFromInventory('Alice', 51)).toBe(true);
    expect(alice.inventory.items.find((e) => e.item === 51)).toBeUndefined();
    expect(sim.map.droppedItems).toHaveLength(1);
  });

  it('refuse to unequip into a full inventory instead of hitting the ground', async () => {
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

    await unequipItem(alice, 'weapon');

    expect(alice.equipped.weapon).toBe(50);
    expect(sim.map.droppedItems).toHaveLength(0);
    expect(alice.inventory.items).toHaveLength(10);
  });

  it('unequip normally when there is inventory space', async () => {
    const sim = createFixture(0);
    sim.addItem(item(50, { bound: true }));
    const alice = sim.addPlayer({
      name: 'Alice',
      inventory: { items: [], maxCapacity: 10 },
      equipped: { weapon: 50 },
    });

    await unequipItem(alice, 'weapon');

    expect(alice.equipped.weapon).toBeUndefined();
    expect(alice.inventory.items).toEqual([{ item: 50, quantity: 1 }]);
  });

  it('equipping a replacement never destroys an equipped bound item', async () => {
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
          { item: 60, quantity: 1 },
        ],
        maxCapacity: 10,
      },
      equipped: { weapon: 50 },
    });

    await equipItem(alice, 60);

    expect(alice.equipped.weapon).toBe(50);
    expect(alice.inventory.items.find((e) => e.item === 60)?.quantity).toBe(1);
  });
});
