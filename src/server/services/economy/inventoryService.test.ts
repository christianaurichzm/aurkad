import { describe, it, expect, afterEach, onTestFinished, vi } from 'vitest';
import mongoose from 'mongoose';
import { playerRepository } from '../../persistence/playerRepository.js';
import fc from 'fast-check';
import { createFixture } from '../../sim/simFixture.js';
import type { Item, PlayerServer } from '../../../shared/types.js';
import { EQUIPMENT_SLOTS } from '../../../shared/constants.js';
import { clearAll, on } from '../../engine/hooks.js';
import ItemModel from '../../model/Item.js';
import DeliveryModel from '../../model/Delivery.js';
import { addItem, countItem } from './economyService.js';
import {
  dropItemFromInventory,
  equipItem,
  pickUpItem,
  startDropSweep,
  unequipItem,
} from './inventoryService.js';
import { deleteItem } from '../content/itemService.js';
import { persistDirtyPlayers } from '../../persistence/playerSnapshot.js';

// No database: a connection that reports itself up, and the writes handed to
// it, for the tests about what is written at once.
function spyOnWrites() {
  const ready = vi
    .spyOn(mongoose.connection, 'readyState', 'get')
    .mockReturnValue(mongoose.ConnectionStates.connected);
  const save = vi.spyOn(playerRepository, 'save').mockResolvedValue(true);
  // Each spy restored by name: vi.restoreAllMocks leaves the readyState getter
  // mocked (it is inherited from a non-configurable accessor), and every later
  // write in the file goes to a database that is not there.
  onTestFinished(() => {
    ready.mockRestore();
    save.mockRestore();
  });
  return save;
}

// 40 ticks at 20 Hz.
vi.mock('../../gameConfig.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../gameConfig.js')>();
  return {
    ...actual,
    gameConfig: {
      ...actual.gameConfig,
      world: { ...actual.gameConfig.world, dropLifetimeMs: 2_000 },
    },
  };
});

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

describe('items on the ground', () => {
  it('pile up as one entry per item and tile', () => {
    const sim = createFixture(0);
    sim.addItem(item(70, { type: 'consumable' }));
    sim.addItem(item(71, { type: 'consumable' }));
    sim.addPlayer({
      name: 'Alice',
      inventory: {
        items: [
          { item: 70, quantity: 5 },
          { item: 71, quantity: 1 },
        ],
        maxCapacity: 10,
      },
    });

    for (let i = 0; i < 5; i++) dropItemFromInventory('Alice', 70);
    dropItemFromInventory('Alice', 71);

    expect(
      sim.map.droppedItems.map(({ itemId, quantity }) => [itemId, quantity]),
    ).toEqual([
      [70, 5],
      [71, 1],
    ]);
  });

  // The ground is not saved. Left to the next snapshot, the dropper's stored
  // bag still held what another player had been written with already.
  it('are written off the player who dropped them at once', async () => {
    const sim = createFixture(0);
    sim.addItem(item(70, { type: 'consumable' }));
    const alice = sim.addPlayer({
      name: 'Alice',
      inventory: { items: [{ item: 70, quantity: 1 }], maxCapacity: 10 },
    });
    const saved = spyOnWrites();

    dropItemFromInventory('Alice', 70);

    await vi.waitFor(() =>
      expect(saved).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Alice', inventory: alice.inventory }),
        undefined,
      ),
    );
    expect(alice.inventory.items).toEqual([]);
  });

  it('cannot be picked up until the dropper has been written without them', async () => {
    const sim = createFixture(0);
    sim.addItem(item(70, { type: 'consumable' }));
    const alice = sim.addPlayer({
      name: 'Alice',
      inventory: { items: [{ item: 70, quantity: 1 }], maxCapacity: 10 },
    });
    const bob = sim.addPlayer({ name: 'Bob', position: { ...alice.position } });
    const saved = spyOnWrites();
    let land = () => {};
    saved.mockImplementationOnce(
      () => new Promise((resolve) => (land = () => resolve(true))),
    );
    onTestFinished(() => land());

    dropItemFromInventory('Alice', 70);
    await vi.waitFor(() => expect(saved).toHaveBeenCalled());
    pickUpItem(sim.map, bob);
    expect(countItem(bob.inventory, 70)).toBe(0);

    land();
    await vi.waitFor(() => {
      pickUpItem(sim.map, bob);
      expect(countItem(bob.inventory, 70)).toBe(1);
    });
  });

  it('stay held after a failed write off the dropper until a retry lands', async () => {
    const sim = createFixture(0);
    sim.addItem(item(70, { type: 'consumable' }));
    const alice = sim.addPlayer({
      name: 'Alice',
      inventory: { items: [{ item: 70, quantity: 1 }], maxCapacity: 10 },
    });
    const bob = sim.addPlayer({ name: 'Bob', position: { ...alice.position } });
    const saved = spyOnWrites();
    saved.mockRejectedValueOnce(new Error('temporary write failure'));

    dropItemFromInventory('Alice', 70);
    await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
    await new Promise((resolve) => setImmediate(resolve));
    pickUpItem(sim.map, bob);
    expect(countItem(bob.inventory, 70)).toBe(0);

    await persistDirtyPlayers();
    await vi.waitFor(() => {
      pickUpItem(sim.map, bob);
      expect(countItem(bob.inventory, 70)).toBe(1);
    });
  });

  it('vanish once their time is up, counted from the last drop on the pile', () => {
    const sim = createFixture(0);
    sim.addItem(item(70, { type: 'consumable' }));
    sim.addPlayer({
      name: 'Alice',
      inventory: { items: [{ item: 70, quantity: 2 }], maxCapacity: 10 },
    });
    startDropSweep();

    dropItemFromInventory('Alice', 70);
    sim.step(30);
    dropItemFromInventory('Alice', 70);
    sim.step(30);
    expect(sim.map.droppedItems).toHaveLength(1);

    sim.step(20);
    expect(sim.map.droppedItems).toHaveLength(0);
  });

  it('stay when the map placed them', () => {
    const sim = createFixture(0);
    sim.map.droppedItems.push({
      itemId: 70,
      sprite: 0,
      position: { x: 0, y: 0 },
      quantity: 1,
    });
    startDropSweep();

    sim.step(100);

    expect(sim.map.droppedItems).toHaveLength(1);
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
    const saved = spyOnWrites();

    equipItem(alice, 60);

    expect(alice.equipped.weapon).toBe(60);
    expect(countItem(alice.inventory, 50)).toBe(1);
    expect(countItem(alice.inventory, 60)).toBe(0);
    expect(alice.inventory.items).toHaveLength(10);
    expect(sim.map.droppedItems).toHaveLength(0);
    expect(saved).not.toHaveBeenCalled();
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

  it('drops the old piece when the new one comes off a stack', async () => {
    const { sim, alice } = fullBag(2);
    const saved = spyOnWrites();

    equipItem(alice, 60);

    expect(alice.equipped.weapon).toBe(60);
    expect(countItem(alice.inventory, 50)).toBe(0);
    expect(countItem(alice.inventory, 60)).toBe(1);
    expect(alice.inventory.items).toHaveLength(10);
    expect(sim.map.droppedItems).toMatchObject([
      { itemId: 50, sprite: 0, position: alice.position, quantity: 1 },
    ]);
    await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
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

  // Each piece sits in its own slot and pieces stack add and multiply on the
  // same stats, so the order things go on and come off varies freely.
  it('come off whole in any order, leaving the stats they found', () => {
    const slots = EQUIPMENT_SLOTS;
    const effect = fc.record({
      attribute: fc.constantFrom('attack' as const, 'defense' as const),
      type: fc.constantFrom('add' as const, 'multiply' as const),
      value: fc.integer({ min: 1, max: 4 }),
    });
    const step = fc.record({
      piece: fc.integer({ min: 0, max: slots.length - 1 }),
      on: fc.boolean(),
    });

    fc.assert(
      fc.property(
        fc.array(fc.array(effect, { maxLength: 2 }), {
          minLength: slots.length,
          maxLength: slots.length,
        }),
        fc.array(step, { maxLength: 30 }),
        (effectsPerPiece, steps) => {
          const sim = createFixture(0);
          slots.forEach((type, i) =>
            sim.addItem(item(80 + i, { type, effects: effectsPerPiece[i] })),
          );
          const alice = sim.addPlayer({
            name: 'Alice',
            attack: 10,
            defense: 7,
            inventory: {
              items: slots.map((_, i) => ({ item: 80 + i, quantity: 1 })),
              maxCapacity: 10,
            },
          });

          for (const { piece, on } of steps) {
            if (on && alice.equipped[slots[piece]!] === undefined) {
              equipItem(alice, 80 + piece);
            } else if (!on) unequipItem(alice, slots[piece]!);
          }
          for (const slot of slots) unequipItem(alice, slot);

          expect(alice.attack).toBeCloseTo(10, 9);
          expect(alice.defense).toBeCloseTo(7, 9);
        },
      ),
    );
  });

  it('come off a slot with no record in the reverse of the order they went on', () => {
    const sim = createFixture(0);
    sim.addItem(
      item(50, {
        effects: [
          { attribute: 'attack', type: 'add', value: 2 },
          { attribute: 'attack', type: 'multiply', value: 3 },
        ],
      }),
    );
    // Worn since before equipping kept a record: the bonus is in the stat,
    // (10 + 2) * 3, and the definition is all there is to undo it.
    const alice = sim.addPlayer({
      name: 'Alice',
      attack: 36,
      equipped: { weapon: 50 },
    });

    unequipItem(alice, 'weapon');

    expect(alice.attack).toBe(10);
  });
});

describe('inventory changes', () => {
  afterEach(() => clearAll());

  it('are told once a tick for whatever changed the bag, and not otherwise', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });
    const told: string[] = [];
    on('inventoryChange', ({ player }) => told.push(player.name));

    sim.step();
    expect(told).toEqual(['Alice']);

    sim.step();
    addItem(alice.inventory, 70, 2);
    addItem(alice.inventory, 70, 3);
    sim.step();
    // A copy swapped in, the way a trade or an auction lands.
    alice.inventory.items = [{ item: 70, quantity: 1 }];
    sim.step();
    sim.step();

    expect(told).toEqual(['Alice', 'Alice', 'Alice']);
  });
});
