// The real module, inventory, escrow and delivery queue share one
// temporary replica set.
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import mongoose from 'mongoose';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { startMemoryReplSet } from '../../../test/mongo.js';
import {
  probeTransactionSupport,
  setTransactionSupportForTest,
} from '../../persistence/transactions.js';
import { playerRepository } from '../../persistence/playerRepository.js';
import DeliveryModel from '../../model/Delivery.js';
import AuctionModel from '../../model/Auction.js';
import { addItem } from '../../services/economy/economyService.js';
import { kvSet } from '../../persistence/kvStore.js';
import { unloadAllModules } from './moduleLoader.js';
import { loadModulesForTest } from '../../../test/modules.js';
import { clearProvides, useApi } from './registry.js';
import { clearCommands } from '../commands.js';
import { clearAll, emit } from '../hooks.js';
import { drainGameEvents } from '../eventBus.js';
import { createFixture } from '../../sim/simFixture.js';
import { msToTicks } from '../../sim/clock.js';
import { kvDelete, kvKeys } from '../../persistence/kvStore.js';

import type { PlayerServer } from '../../../shared/types.js';

let sim: ReturnType<typeof createFixture>;
let mongo: MongoMemoryReplSet;
const queued = () => DeliveryModel.find().lean().exec();
const rows = () => mongoose.connection.collection('auctions');
beforeAll(async () => {
  mongo = await startMemoryReplSet();
  await mongoose.connect(mongo.getUri());
  await probeTransactionSupport();
});
afterAll(async () => {
  setTransactionSupportForTest(false);
  await mongoose.disconnect();
  await mongo.stop();
});

const COIN = 3;
const SWORD = 1;

beforeEach(async () => {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})),
  );
  clearAll();
  clearCommands();
  clearProvides();
  drainGameEvents();
  for (const key of kvKeys('auction')) kvDelete('auction', key);

  sim = createFixture(0);
  sim.addItem({ id: COIN, name: 'Gold', type: 'misc' } as never);
  sim.addItem({ id: SWORD, name: 'Sword', type: 'weapon' } as never);
  loadModulesForTest('auction');
});

afterEach(() => {
  unloadAllModules();
  clearAll();
  clearProvides();
  vi.restoreAllMocks();
});

const auction = () =>
  useApi<{
    listings: () => Promise<
      {
        id: string;
        seller: string;
        item: string;
        quantity: number;
        price: number;
      }[]
    >;
    list: (
      p: PlayerServer,
      itemId: number,
      quantity: number,
      price: number,
    ) => Promise<string>;
    buy: (p: PlayerServer, id: string) => Promise<string>;
    cancel: (p: PlayerServer, id: string) => Promise<string>;
  }>('auction')!;

// An inventory row names the item as `item`, not `itemId` (shared/types.ts).
async function playerWith(
  name: string,
  items: { item: number; quantity: number }[],
) {
  const player = sim.addPlayer({ name });
  player.inventory.items = items.map((entry) => ({ ...entry }));
  await playerRepository.insert({ ...player, password: 'hash' });
  return player;
}

const countOf = (player: PlayerServer, itemId: number) =>
  player.inventory.items
    .filter((entry) => entry.item === itemId)
    .reduce((sum, entry) => sum + entry.quantity, 0);

describe('listing', () => {
  it('takes the item out of the seller bag and holds it', async () => {
    const seller = await playerWith('Ana', [{ item: SWORD, quantity: 2 }]);

    await auction().list(seller, SWORD, 2, 50);

    expect(countOf(seller, SWORD)).toBe(0);
    expect(await auction().listings()).toMatchObject([
      { seller: 'Ana', item: 'Sword', quantity: 2, price: 50 },
    ]);
  });

  it('refuses more than the seller has, and takes nothing', async () => {
    const seller = await playerWith('Ana', [{ item: SWORD, quantity: 1 }]);

    const reply = await auction().list(seller, SWORD, 5, 50);

    expect(reply).toBe('You do not have that many.');
    expect(countOf(seller, SWORD)).toBe(1);
    expect(await auction().listings()).toEqual([]);
  });

  it('refuses a price below one, so nothing is listed for free', async () => {
    const seller = await playerWith('Ana', [{ item: SWORD, quantity: 1 }]);

    expect(await auction().list(seller, SWORD, 1, 0)).toBe(
      'The price has to be at least 1.',
    );
    expect(countOf(seller, SWORD)).toBe(1);
  });

  it('refuses an item that does not exist', async () => {
    const seller = await playerWith('Ana', [{ item: SWORD, quantity: 1 }]);

    expect(await auction().list(seller, 999, 1, 10)).toBe('No such item.');
  });
});

describe('buying', () => {
  it('moves the coins and the item in the one exchange', async () => {
    const seller = await playerWith('Ana', [{ item: SWORD, quantity: 1 }]);
    const buyer = await playerWith('Bo', [{ item: COIN, quantity: 100 }]);
    await auction().list(seller, SWORD, 1, 50);
    const [listing] = await auction().listings();

    await auction().buy(buyer, listing!.id);

    expect(countOf(buyer, SWORD)).toBe(1);
    expect(countOf(buyer, COIN)).toBe(50);
    expect(await auction().listings()).toEqual([]);
  });

  it('pays the seller through the queue, which reaches them offline', async () => {
    const seller = await playerWith('Ana', [{ item: SWORD, quantity: 1 }]);
    const buyer = await playerWith('Bo', [{ item: COIN, quantity: 100 }]);
    await auction().list(seller, SWORD, 1, 50);
    const [listing] = await auction().listings();

    await auction().buy(buyer, listing!.id);

    expect(await queued()).toMatchObject([
      { to: 'Ana', itemId: COIN, quantity: 50 },
    ]);
  });

  it('owes the seller a refused payment until the sweep delivers it', async () => {
    const seller = await playerWith('Ana', [{ item: SWORD, quantity: 1 }]);
    const buyer = await playerWith('Bo', [{ item: COIN, quantity: 100 }]);
    await auction().list(seller, SWORD, 1, 50);
    const [listing] = await auction().listings();
    const write = vi
      .spyOn(DeliveryModel, 'create')
      .mockRejectedValueOnce(new Error('storage down'));

    await auction().buy(buyer, listing!.id);
    expect(await queued()).toEqual([]);
    expect(await rows().findOne({ state: 'unpaid' })).not.toBeNull();
    write.mockRestore();

    sim.step(msToTicks(60_000));
    await vi.waitFor(async () =>
      expect(await rows().countDocuments({})).toBe(0),
    );
    expect(await queued()).toMatchObject([
      { to: 'Ana', itemId: COIN, quantity: 50 },
    ]);
  });

  it('refuses a buyer who cannot afford it, and leaves the listing up', async () => {
    const seller = await playerWith('Ana', [{ item: SWORD, quantity: 1 }]);
    const buyer = await playerWith('Bo', [{ item: COIN, quantity: 10 }]);
    await auction().list(seller, SWORD, 1, 50);
    const [listing] = await auction().listings();

    const reply = await auction().buy(buyer, listing!.id);

    expect(reply).toContain('You need 50');
    expect(await auction().listings()).toHaveLength(1);
    expect(countOf(buyer, COIN)).toBe(10);
    expect(await queued()).toEqual([]);
  });

  it('refuses the seller buying their own listing', async () => {
    const seller = await playerWith('Ana', [
      { item: SWORD, quantity: 1 },
      { item: COIN, quantity: 100 },
    ]);
    await auction().list(seller, SWORD, 1, 50);
    const [listing] = await auction().listings();

    expect(await auction().buy(seller, listing!.id)).toBe(
      'You cannot buy your own listing.',
    );
    expect(await auction().listings()).toHaveLength(1);
  });

  it('cannot be sold twice, because the listing is reserved before the money moves', async () => {
    const seller = await playerWith('Ana', [{ item: SWORD, quantity: 1 }]);
    const first = await playerWith('Bo', [{ item: COIN, quantity: 100 }]);
    const second = await playerWith('Cy', [{ item: COIN, quantity: 100 }]);
    await auction().list(seller, SWORD, 1, 50);
    const [listing] = await auction().listings();

    const [a, b] = await Promise.all([
      auction().buy(first, listing!.id),
      auction().buy(second, listing!.id),
    ]);

    const bought = [a, b].filter((reply) => reply.startsWith('Bought'));
    expect(bought).toHaveLength(1);
    expect(countOf(first, SWORD) + countOf(second, SWORD)).toBe(1);
  });

  it('puts the listing back when the buyer bag is full', async () => {
    const seller = await playerWith('Ana', [{ item: SWORD, quantity: 1 }]);
    const buyer = await playerWith('Bo', [{ item: COIN, quantity: 100 }]);
    buyer.inventory.maxCapacity = 1; // the coins already fill it
    await auction().list(seller, SWORD, 1, 50);
    const [listing] = await auction().listings();

    const reply = await auction().buy(buyer, listing!.id);

    expect(reply).toBe('Your bag is full.');
    expect(await auction().listings()).toHaveLength(1);
    expect(countOf(buyer, COIN)).toBe(100);
  });
});

describe('cancelling', () => {
  it('returns the item through the queue, not straight to the bag', async () => {
    const seller = await playerWith('Ana', [{ item: SWORD, quantity: 2 }]);
    await auction().list(seller, SWORD, 2, 50);
    const [listing] = await auction().listings();

    const reply = await auction().cancel(seller, listing!.id);

    expect(reply).toBe('Cancelled, and the item is in your mailbox.');
    expect(await queued()).toMatchObject([
      { to: 'Ana', itemId: SWORD, quantity: 2 },
    ]);
    expect(await auction().listings()).toEqual([]);
  });

  it('keeps the listing when the mailbox has no room for the item', async () => {
    const seller = await playerWith('Ana', [{ item: SWORD, quantity: 1 }]);
    await auction().list(seller, SWORD, 1, 50);
    const [listing] = await auction().listings();
    await DeliveryModel.insertMany(
      Array.from({ length: 100 }, (_, i) => ({
        id: `full${i}`,
        to: seller.name,
        itemId: COIN,
        quantity: 1,
        source: 'test',
        createdAt: Date.now(),
      })),
    );

    const reply = await auction().cancel(seller, listing!.id);

    expect(reply).toBe(
      'Your mailbox has no room for it, so the listing stays up.',
    );
    expect(await auction().listings()).toHaveLength(1);
  });

  it('refuses somebody else listing', async () => {
    const seller = await playerWith('Ana', [{ item: SWORD, quantity: 1 }]);
    const other = await playerWith('Bo', []);
    await auction().list(seller, SWORD, 1, 50);
    const [listing] = await auction().listings();

    expect(await auction().cancel(other, listing!.id)).toBe(
      'That listing is not yours.',
    );
    expect(await auction().listings()).toHaveLength(1);
  });
});

describe('what the client is sent', () => {
  it('carries the item names, so the client does not need the catalogue', async () => {
    const seller = await playerWith('Ana', [{ item: SWORD, quantity: 1 }]);
    const buyer = await playerWith('Bo', []);
    await auction().list(seller, SWORD, 1, 50);
    drainGameEvents();

    emit('customAction', {
      player: buyer,
      channel: 'auction:request',
      payload: null,
    });

    const events: ReturnType<typeof drainGameEvents> = [];
    await vi.waitFor(() => {
      events.push(...drainGameEvents());
      expect(
        events.some(
          (e) => e.type === 'customPlayer' && e.channel === 'auction:update',
        ),
      ).toBe(true);
    });
    const update = events.find(
      (e) => e.type === 'customPlayer' && e.channel === 'auction:update',
    ) as
      | { payload: { listings: { item: string }[]; currency: string } }
      | undefined;
    expect(update?.payload.listings[0]?.item).toBe('Sword');
    expect(update?.payload.currency).toBe('Gold');
  });
});

describe('durability and recovery', () => {
  it('does not announce a listing when the seller write is refused', async () => {
    const seller = await playerWith('Ana', [{ item: SWORD, quantity: 1 }]);
    vi.spyOn(playerRepository, 'save').mockResolvedValueOnce(false);
    expect(await auction().list(seller, SWORD, 1, 50)).not.toContain('Listed');
    expect(await auction().listings()).toEqual([]);
    expect(countOf(seller, SWORD)).toBe(1);
    expect((await playerRepository.findByName('Ana'))?.inventory.items).toEqual(
      seller.inventory.items,
    );
  });

  it('keeps a failed purchase in escrow without debiting the buyer or paying the seller', async () => {
    const seller = await playerWith('Ana', [{ item: SWORD, quantity: 1 }]);
    const buyer = await playerWith('Bo', [{ item: COIN, quantity: 100 }]);
    await auction().list(seller, SWORD, 1, 50);
    const [listing] = await auction().listings();
    vi.spyOn(playerRepository, 'save').mockResolvedValueOnce(false);
    expect(await auction().buy(buyer, listing!.id)).not.toContain('Bought');
    expect(countOf(buyer, COIN)).toBe(100);
    expect(countOf(buyer, SWORD)).toBe(0);
    expect(await queued()).toEqual([]);
    expect(await auction().listings()).toHaveLength(1);
  });

  it('survives module reload and retries a durable debt exactly once', async () => {
    const seller = await playerWith('Ana', [{ item: SWORD, quantity: 1 }]);
    const buyer = await playerWith('Bo', [{ item: COIN, quantity: 100 }]);
    await auction().list(seller, SWORD, 1, 50);
    const [listing] = await auction().listings();
    const write = vi
      .spyOn(DeliveryModel, 'create')
      .mockRejectedValue(new Error('storage down'));
    await auction().buy(buyer, listing!.id);
    expect(await rows().findOne({ state: 'unpaid' })).not.toBeNull();
    unloadAllModules();
    clearProvides();
    write.mockRestore();
    loadModulesForTest('auction');
    sim.step(msToTicks(60_000));
    await vi.waitFor(async () => expect(await queued()).toHaveLength(1));
    sim.step(msToTicks(60_000));
    await vi.waitFor(async () =>
      expect(await rows().countDocuments({})).toBe(0),
    );
    expect(await queued()).toMatchObject([
      { to: 'Ana', itemId: COIN, quantity: 50 },
    ]);
    expect(countOf(buyer, SWORD)).toBe(1);
  });

  it('returns an expired listing once when sweeps overlap', async () => {
    const seller = await playerWith('Ana', [{ item: SWORD, quantity: 2 }]);
    await auction().list(seller, SWORD, 2, 50);
    await rows().updateMany({}, { $set: { expiresAt: 0 } });
    sim.step(msToTicks(120_000));
    await vi.waitFor(async () =>
      expect(await rows().countDocuments({})).toBe(0),
    );
    expect(await queued()).toMatchObject([
      { to: 'Ana', itemId: SWORD, quantity: 2 },
    ]);
    expect(await queued()).toHaveLength(1);
  });

  it('rolls back the durable seller debit when escrow cannot be inserted', async () => {
    const seller = await playerWith('Ana', [{ item: SWORD, quantity: 1 }]);
    vi.spyOn(AuctionModel, 'create').mockRejectedValueOnce(
      new Error('escrow unavailable'),
    );
    expect(await auction().list(seller, SWORD, 1, 50)).not.toContain('Listed');
    expect(countOf(seller, SWORD)).toBe(1);
    expect((await playerRepository.findByName('Ana'))?.inventory.items).toEqual(
      seller.inventory.items,
    );
    expect(await rows().countDocuments({})).toBe(0);
  });

  it('blocks inventory changes until an in-flight purchase is durable', async () => {
    const seller = await playerWith('Ana', [{ item: SWORD, quantity: 1 }]);
    const buyer = await playerWith('Bo', [{ item: COIN, quantity: 100 }]);
    await auction().list(seller, SWORD, 1, 50);
    const [listing] = await auction().listings();
    let release!: () => void;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const real = playerRepository.save.bind(playerRepository);
    const writing = vi
      .spyOn(playerRepository, 'save')
      .mockImplementationOnce(async (player, session) => {
        await paused;
        return real(player, session);
      });
    const buying = auction().buy(buyer, listing!.id);
    await vi.waitFor(() => expect(writing).toHaveBeenCalled());
    expect(addItem(buyer.inventory, SWORD, 1)).toEqual({
      ok: false,
      reason: 'busy',
    });
    expect(countOf(buyer, COIN)).toBe(100);
    release();
    expect(await buying).toContain('Bought');
    expect(countOf(buyer, SWORD)).toBe(1);
    expect(countOf(buyer, COIN)).toBe(50);
  });

  it('rolls back a queued return if removal of the listing fails', async () => {
    const seller = await playerWith('Ana', [{ item: SWORD, quantity: 1 }]);
    await auction().list(seller, SWORD, 1, 50);
    const [listing] = await auction().listings();
    vi.spyOn(AuctionModel, 'deleteOne').mockRejectedValueOnce(
      new Error('delete unavailable'),
    );
    expect(await auction().cancel(seller, listing!.id)).not.toContain(
      'Cancelled',
    );
    expect(await queued()).toEqual([]);
    expect(await auction().listings()).toHaveLength(1);
  });

  it('preserves ambiguous legacy entries for reconciliation', () => {
    for (const state of ['pending', 'sold', 'paying', 'returning', 'unpaid'])
      kvSet('auction', state, { id: state, state, seller: 'Ana' });
    unloadAllModules();
    clearProvides();
    loadModulesForTest('auction');
    expect(kvKeys('auction').sort()).toEqual([
      'paying',
      'pending',
      'returning',
      'sold',
      'unpaid',
    ]);
  });

  it('reports failure without taking items when opening the DB session fails', async () => {
    const seller = await playerWith('Ana', [{ item: SWORD, quantity: 1 }]);
    vi.spyOn(mongoose, 'startSession').mockRejectedValueOnce(
      new Error('connection lost'),
    );
    expect(await auction().list(seller, SWORD, 1, 50)).not.toContain('Listed');
    expect(countOf(seller, SWORD)).toBe(1);
    expect(await auction().listings()).toEqual([]);
  });

  it('refuses auction writes on standalone Mongo before taking any item', async () => {
    const seller = await playerWith('Ana', [{ item: SWORD, quantity: 1 }]);
    setTransactionSupportForTest(false);
    try {
      expect(await auction().list(seller, SWORD, 1, 50)).not.toContain(
        'Listed',
      );
      expect(countOf(seller, SWORD)).toBe(1);
      expect(await rows().countDocuments({})).toBe(0);
    } finally {
      setTransactionSupportForTest(true);
    }
  });
});
