/**
 * Counting every item that exists.
 *
 * The value of a census is exactly the completeness of the list of places it
 * looks: a store left out is a place duplication can hide, so most of these
 * pin one store each. The rest cover the comparison, which is what turns a
 * count into a signal.
 */
import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
} from 'vitest';
import mongoose from 'mongoose';
import fc from 'fast-check';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { startMemoryReplSet } from '../../../test/mongo.js';
import { loadModulesForTest } from '../../../test/modules.js';
import {
  probeTransactionSupport,
  setTransactionSupportForTest,
} from '../../persistence/transactions.js';
import { clearKvStoreMemory } from '../../persistence/kvStore.js';
import { unloadAllModules } from '../../engine/modules/moduleLoader.js';
import { clearProvides, useApi } from '../../engine/modules/registry.js';
import { clearCommands } from '../../engine/commands.js';
import { clearAll } from '../../engine/hooks.js';
import { getMap, getPlayerByName } from '../../sim/world.js';
import { tile } from '../../sim/simFixture.js';
import {
  disconnectPlayer,
  enterWorld,
  getPlayerByNameFromDb,
} from '../player/playerService.js';
import {
  dropItemFromInventory,
  pickUpItem,
  useItem,
} from './inventoryService.js';
import type { PlayerServer } from '../../../shared/types.js';
import DeliveryModel from '../../model/Delivery.js';
import AuctionModel from '../../model/Auction.js';
import EconomyCensusModel from '../../model/EconomyCensus.js';
import { compareCensus, isSuspicious, takeCensus } from './economyCensus.js';
import { createFixture } from '../../sim/simFixture.js';
import { createPlayer } from '../player/playerService.js';
import { playerRepository } from '../../persistence/playerRepository.js';
import { playersByName } from '../../sim/state.js';
import type { EconomyCensus } from './economyCensus.js';

// A replica set, so economic commits can run both ways they run in
// production: in a transaction, and as separate writes where there is none.
let mongod: MongoMemoryReplSet;

beforeAll(async () => {
  mongod = await startMemoryReplSet();
  await mongoose.connect(mongod.getUri());
}, 30_000);

afterAll(async () => {
  setTransactionSupportForTest(false);
  await mongoose.disconnect();
  await mongod.stop();
});

const GOLD = 3;
const SWORD = 2;

beforeEach(async () => {
  const cols = mongoose.connection.collections;
  await Promise.all(Object.values(cols).map((c) => c.deleteMany({})));
  createFixture(0);
  playersByName.clear();
});

const totalOf = (census: EconomyCensus, itemId: number) =>
  census.items.find((i) => i.itemId === itemId)?.total ?? 0;

describe('takeCensus', () => {
  it('counts listed items and seller proceeds held in auction escrow', async () => {
    await AuctionModel.create([
      {
        id: 'active',
        state: 'active',
        seller: 'Alice',
        itemId: SWORD,
        quantity: 2,
        price: 50,
        listedAt: 0,
        expiresAt: Date.now() + 1000,
      },
      {
        id: 'debt',
        state: 'unpaid',
        seller: 'Bob',
        itemId: SWORD,
        quantity: 1,
        price: 50,
        listedAt: 0,
        expiresAt: 0,
        currencyItemId: GOLD,
        payout: 45,
      },
    ]);
    const census = await takeCensus();
    expect(totalOf(census, SWORD)).toBe(2);
    expect(totalOf(census, GOLD)).toBe(45);
    expect(
      census.items.find((i) => i.itemId === GOLD)?.byLocation.auction,
    ).toBe(45);
  });

  it('counts what a logged-out player is holding', async () => {
    const offline = await createPlayer('Alice', 'hash');
    offline.inventory = {
      items: [{ item: GOLD, quantity: 40 }],
      maxCapacity: 10,
    };
    await playerRepository.save(offline);

    const census = await takeCensus();

    expect(totalOf(census, GOLD)).toBe(40);
    expect(census.players).toBe(1);
  });

  // Most items belong to players who are logged out; counting only the
  // connected ones would read a normal evening as a mass disappearance.
  it('counts online and offline players together, without double counting', async () => {
    const sim = createFixture(0);
    const alice = await createPlayer('Alice', 'hash');
    alice.inventory = {
      items: [{ item: GOLD, quantity: 10 }],
      maxCapacity: 10,
    };
    await playerRepository.save(alice);
    const bob = await createPlayer('Bob', 'hash');
    bob.inventory = { items: [{ item: GOLD, quantity: 5 }], maxCapacity: 10 };
    await playerRepository.save(bob);
    // Bob is connected and has picked up more since his document was written.
    sim.addPlayer({
      name: 'Bob',
      inventory: { items: [{ item: GOLD, quantity: 25 }], maxCapacity: 10 },
    });

    const census = await takeCensus();

    // 10 from Alice's document, 25 from Bob's live session (not the stale 5).
    expect(totalOf(census, GOLD)).toBe(35);
  });

  // Equipment lives off the inventory but is still an item that exists.
  it('counts equipped gear', async () => {
    const alice = await createPlayer('Alice', 'hash');
    alice.inventory = { items: [], maxCapacity: 10 };
    alice.equipped = { weapon: SWORD };
    await playerRepository.save(alice);

    expect(totalOf(await takeCensus(), SWORD)).toBe(1);
  });

  // The bank parks a container in the data bag; so would any store a game
  // invents, which is why this matches the shape rather than the key.
  it('counts containers a module parked in player data', async () => {
    const alice = await createPlayer('Alice', 'hash');
    alice.inventory = { items: [], maxCapacity: 10 };
    alice.data = {
      bank: { maxCapacity: 50, items: [{ item: GOLD, quantity: 900 }] },
      vault: { maxCapacity: 10, items: [{ item: SWORD, quantity: 2 }] },
      questProgress: { goblins: 3 },
    };
    await playerRepository.save(alice);

    const census = await takeCensus();

    expect(totalOf(census, GOLD)).toBe(900);
    expect(totalOf(census, SWORD)).toBe(2);
    expect(
      census.items.find((i) => i.itemId === GOLD)?.byLocation.playerData,
    ).toBe(900);
  });

  // The newest hiding place: real items held outside any player document.
  it('counts items waiting in the delivery queue', async () => {
    await DeliveryModel.create({
      id: 'd1',
      to: 'Alice',
      itemId: GOLD,
      quantity: 500,
      source: 'mail',
      createdAt: Date.now(),
    });

    const census = await takeCensus();

    expect(totalOf(census, GOLD)).toBe(500);
    expect(
      census.items.find((i) => i.itemId === GOLD)?.byLocation.delivery,
    ).toBe(500);
  });

  it('counts what is lying on the ground', async () => {
    const sim = createFixture(0);
    sim.map.droppedItems.push({
      itemId: GOLD,
      quantity: 7,
      sprite: 0,
      position: { x: 0, y: 0 },
    });

    expect(totalOf(await takeCensus(), GOLD)).toBe(7);
  });

  // An alert with no name to check is a notification, not a lead.
  it('names the biggest holders', async () => {
    const rich = await createPlayer('Rich', 'hash');
    rich.inventory = {
      items: [{ item: GOLD, quantity: 1000 }],
      maxCapacity: 10,
    };
    await playerRepository.save(rich);
    const poor = await createPlayer('Poor', 'hash');
    poor.inventory = { items: [{ item: GOLD, quantity: 5 }], maxCapacity: 10 };
    await playerRepository.save(poor);

    const census = await takeCensus();

    expect(census.items.find((i) => i.itemId === GOLD)?.topHolders[0]).toEqual({
      name: 'Rich',
      quantity: 1000,
    });
  });

  it('has nothing to report on an empty world', async () => {
    const census = await takeCensus();
    expect(census.items).toEqual([]);
    expect(census.players).toBe(0);
  });
});

describe('compareCensus', () => {
  const census = (
    at: number,
    items: Array<[number, number]>,
  ): EconomyCensus => ({
    at,
    players: 1,
    items: items.map(([itemId, total]) => ({
      itemId,
      total,
      byLocation: {
        inventory: total,
        equipped: 0,
        playerData: 0,
        delivery: 0,
        ground: 0,
        auction: 0,
      },
      topHolders: [],
    })),
  });

  it('reports growth, biggest move first', () => {
    const deltas = compareCensus(
      census(1, [
        [GOLD, 100],
        [SWORD, 5],
      ]),
      census(2, [
        [GOLD, 400],
        [SWORD, 6],
      ]),
    );

    expect(deltas.map((d) => d.itemId)).toEqual([GOLD, SWORD]);
    expect(deltas[0]).toMatchObject({ before: 100, after: 400, change: 300 });
  });

  it('says nothing about a total that held still', () => {
    expect(
      compareCensus(census(1, [[GOLD, 100]]), census(2, [[GOLD, 100]])),
    ).toEqual([]);
  });

  // An item that disappeared entirely is as interesting as one that appeared.
  it('reports an item that vanished', () => {
    const deltas = compareCensus(census(1, [[GOLD, 50]]), census(2, []));

    expect(deltas[0]).toMatchObject({ itemId: GOLD, after: 0, change: -50 });
  });

  it('reports an item that did not exist before', () => {
    const deltas = compareCensus(census(1, []), census(2, [[SWORD, 3]]));

    expect(deltas[0]).toMatchObject({ before: 0, after: 3, change: 3 });
  });
});

describe('isSuspicious', () => {
  const delta = (before: number, after: number) => ({
    itemId: GOLD,
    before,
    after,
    change: after - before,
    topHolders: [],
  });

  // Growth alone is normal: loot mints items every kill.
  it('ignores ordinary growth', () => {
    expect(isSuspicious(delta(10_000, 10_050))).toBe(false);
  });

  it('flags a total that doubled', () => {
    expect(isSuspicious(delta(1_000, 2_000))).toBe(true);
  });

  // The floor is what keeps a handful of new potions from crying wolf on a
  // quiet server, where any doubling is small in absolute terms.
  it('ignores a doubling that is small in absolute terms', () => {
    expect(isSuspicious(delta(3, 6))).toBe(false);
  });

  it('flags an item that appeared out of nothing', () => {
    expect(isSuspicious(delta(0, 5_000))).toBe(true);
  });

  it('never flags a decrease, which is spending', () => {
    expect(isSuspicious(delta(10_000, 10))).toBe(false);
  });
});

// The retention claim holds only if the index exists: `index: true` on the
// field plus a TTL index on the same key makes mongoose create the plain one
// and skip the TTL, and the collection would grow forever unnoticed.
describe('retention', () => {
  it('expires stored censuses through a TTL index', async () => {
    await EconomyCensusModel.syncIndexes();
    const indexes = await EconomyCensusModel.collection.indexes();
    const ttl = indexes.find((i) => i.expireAfterSeconds !== undefined);

    expect(ttl?.key).toEqual({ at: 1 });
    expect(ttl?.expireAfterSeconds).toBeGreaterThan(0);
  });
});

// The census exists to catch an item minted or lost where two systems meet,
// like a trade accepted while the same sword is being listed. So players
// here do everything at once and leave and come back in between, and none
// of it may change what exists.
describe('across every system that moves an item', () => {
  const HERB = 4;
  const NAMES = ['Ana', 'Bo', 'Cid'];

  type Op =
    | { kind: 'drop'; who: number; item: number; qty: number }
    | { kind: 'pickUp' | 'wield' | 'claim'; who: number }
    | { kind: 'deposit'; who: number; item: number; qty: number }
    | { kind: 'withdraw'; who: number; slot: number; qty: number }
    | {
        kind: 'trade';
        who: number;
        to: number;
        give: number;
        giveQty: number;
        want: number;
        wantQty: number;
      }
    | { kind: 'list'; who: number; item: number; qty: number; price: number }
    | { kind: 'buy' | 'cancel'; who: number; listing: number }
    | { kind: 'mail'; who: number; to: number; item: number; qty: number }
    | { kind: 'leave' | 'rejoin'; who: number };

  const who = fc.nat({ max: NAMES.length - 1 });
  // Somebody else, as an offset from `who`: trading or writing to yourself is
  // refused before it gets anywhere.
  const other = fc.integer({ min: 1, max: NAMES.length - 1 });
  const item = fc.constantFrom(GOLD, SWORD, HERB);
  const qty = fc.oneof(
    { weight: 3, arbitrary: fc.constant(1) },
    fc.integer({ min: 2, max: 4 }),
  );
  const op: fc.Arbitrary<Op> = fc.oneof(
    fc.record({ kind: fc.constant('drop'), who, item, qty }),
    fc.record({
      kind: fc.constantFrom('pickUp', 'wield', 'claim'),
      who,
    }),
    fc.record({ kind: fc.constant('deposit'), who, item, qty }),
    {
      weight: 2,
      arbitrary: fc.record({
        kind: fc.constant('withdraw'),
        who,
        slot: fc.nat(3),
        qty,
      }),
    },
    {
      weight: 2,
      arbitrary: fc.record({
        kind: fc.constant('trade'),
        who,
        to: other,
        give: item,
        giveQty: qty,
        want: item,
        wantQty: qty,
      }),
    },
    fc.record({
      kind: fc.constant('list'),
      who,
      item,
      qty,
      price: fc.integer({ min: 1, max: 30 }),
    }),
    fc.record({
      kind: fc.constantFrom('buy', 'cancel'),
      who,
      listing: fc.nat({ max: 5 }),
    }),
    fc.record({ kind: fc.constant('mail'), who, to: other, item, qty }),
    fc.record({ kind: fc.constantFrom('leave', 'rejoin'), who }),
  );
  // Each inner list starts together and is awaited together.
  const batches = fc.array(fc.array(op, { minLength: 1, maxLength: 3 }), {
    maxLength: 15,
  });

  type Apis = {
    trade: {
      offer(
        p: PlayerServer,
        to: string,
        give: number,
        giveQty: number,
        want: number,
        wantQty: number,
      ): string;
      accept(p: PlayerServer, from: string): Promise<string>;
    };
    bank: {
      get(p: PlayerServer): { items: { item: number; quantity: number }[] };
      deposit(p: PlayerServer, item: number, qty: number): string;
      withdraw(p: PlayerServer, item: number, qty: number): string;
    };
    auction: {
      listings(): Promise<{ id: string }[]>;
      list(
        p: PlayerServer,
        item: number,
        qty: number,
        price: number,
      ): Promise<string>;
      buy(p: PlayerServer, id: string): Promise<string>;
      cancel(p: PlayerServer, id: string): Promise<string>;
    };
    mail: {
      send(
        p: PlayerServer,
        to: string,
        item: number,
        qty: number,
        message: string,
      ): Promise<string>;
      claim(p: PlayerServer): Promise<string>;
    };
  };
  const api = <K extends keyof Apis>(id: K) => useApi<Apis[K]>(id)!;

  const nameOf = (who: number, offset = 0) =>
    NAMES[(who + offset) % NAMES.length]!;

  async function apply(o: Op): Promise<void> {
    const name = nameOf(o.who);
    const player = getPlayerByName(name);
    if (o.kind === 'rejoin') {
      if (player) return;
      const record = await getPlayerByNameFromDb(name);
      if (record) enterWorld({ ...record });
      return;
    }
    if (!player) return;
    switch (o.kind) {
      case 'leave':
        return disconnectPlayer(name);
      case 'drop':
        dropItemFromInventory(name, o.item, o.qty);
        return;
      case 'pickUp':
        pickUpItem(getMap(player.mapId)!, player);
        return;
      case 'wield':
        // The client's way to put the sword on or take it off.
        useItem(name, SWORD);
        return;
      case 'deposit':
        api('bank').deposit(player, o.item, o.qty);
        return;
      case 'withdraw': {
        const held = api('bank').get(player).items;
        const entry = held[o.slot % Math.max(1, held.length)];
        if (entry) {
          api('bank').withdraw(
            player,
            entry.item,
            Math.min(o.qty, entry.quantity),
          );
        }
        return;
      }
      case 'trade': {
        const partner = getPlayerByName(nameOf(o.who, o.to));
        api('trade').offer(
          player,
          nameOf(o.who, o.to),
          o.give,
          o.giveQty,
          o.want,
          o.wantQty,
        );
        if (partner) await api('trade').accept(partner, name);
        return;
      }
      case 'list':
        await api('auction').list(player, o.item, o.qty, o.price);
        return;
      case 'buy':
      case 'cancel': {
        const listings = await api('auction').listings();
        const target = listings[o.listing % Math.max(1, listings.length)];
        if (target) await api('auction')[o.kind](player, target.id);
        return;
      }
      case 'mail':
        await api('mail').send(
          player,
          nameOf(o.who, o.to),
          o.item,
          o.qty,
          'hi',
        );
        return;
      case 'claim':
        await api('mail').claim(player);
        return;
    }
  }

  /**
   * One arrival or departure per player at a time, which is what the socket
   * lanes guarantee: two of them racing is a state the server never reaches.
   */
  const oneSessionChangeEach = (batch: Op[]) => {
    const changing = new Set<number>();
    return batch.filter((o) => {
      if (o.kind !== 'leave' && o.kind !== 'rejoin') return true;
      if (changing.has(o.who)) return false;
      changing.add(o.who);
      return true;
    });
  };

  const totals = (census: EconomyCensus) =>
    Object.fromEntries(census.items.map((i) => [i.itemId, i.total]));

  async function play(sessions: Op[][]): Promise<void> {
    const cols = mongoose.connection.collections;
    await Promise.all(Object.values(cols).map((c) => c.deleteMany({})));
    unloadAllModules();
    clearAll();
    clearCommands();
    clearProvides();
    clearKvStoreMemory();
    const sim = createFixture(0);
    sim.addItem({
      id: GOLD,
      name: 'Gold',
      description: '',
      sprite: 0,
      type: 'money',
    });
    sim.addItem({
      id: SWORD,
      name: 'Sword',
      description: '',
      sprite: 0,
      type: 'weapon',
    });
    sim.addItem({
      id: HERB,
      name: 'Herb',
      description: '',
      sprite: 0,
      type: 'consumable',
    });
    loadModulesForTest('trade', 'bank', 'auction', 'mail');

    for (const name of NAMES) {
      const player = sim.addPlayer({
        name,
        position: tile(5, 5),
        inventory: {
          items: [
            { item: GOLD, quantity: 100 },
            { item: SWORD, quantity: 1 },
            { item: HERB, quantity: 5 },
          ],
          maxCapacity: 10,
        },
      });
      await playerRepository.insert({ ...player, password: 'hash' });
      enterWorld(player);
    }

    const before = totals(await takeCensus());
    for (const batch of sessions) {
      const results = await Promise.allSettled(
        oneSessionChangeEach(batch).map(apply),
      );
      const thrown = results.flatMap((r) =>
        r.status === 'rejected' ? [String(r.reason)] : [],
      );
      expect(thrown).toEqual([]);
      expect(totals(await takeCensus())).toEqual(before);
    }
  }

  afterEach(() => {
    unloadAllModules();
    clearAll();
    clearProvides();
  });

  it('keeps every item, with commits in a transaction', async () => {
    expect(await probeTransactionSupport()).toBe(true);
    await fc.assert(fc.asyncProperty(batches, play), { numRuns: 20 });
  });

  it('keeps every item, with commits as separate writes', async () => {
    setTransactionSupportForTest(false);
    await fc.assert(fc.asyncProperty(batches, play), { numRuns: 20 });
  });
});
