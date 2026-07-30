/**
 * Counting every item that exists.
 *
 * The value of a census is exactly the completeness of the list of places it
 * looks: a store left out is a place duplication can hide, so most of these
 * pin one store each. The rest cover the comparison, which is what turns a
 * count into a signal.
 */
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import DeliveryModel from '../../model/Delivery.js';
import EconomyCensusModel from '../../model/EconomyCensus.js';
import { compareCensus, takeCensus } from './economyCensus.js';
import { isSuspicious } from './censusJob.js';
import { createFixture } from '../../sim/simFixture.js';
import { createPlayer } from '../player/playerService.js';
import { playerRepository } from '../../persistence/playerRepository.js';
import { playersByName } from '../../sim/state.js';
import type { EconomyCensus } from './economyCensus.js';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}, 30_000);

afterAll(async () => {
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
