/**
 * The atomicity of an economic commit, against both deployments the engine
 * actually runs on: a standalone mongod (docker-compose default, no
 * transactions) and a replica set (transactions).
 *
 * The property under test is the one a trade needs and a pair of independent
 * writes cannot give: when the commit fails, *neither* player document moved.
 * Half a trade is a duplicated or destroyed item, which is the failure the
 * whole economy funnel exists to prevent.
 */
import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from 'vitest';
import mongoose from 'mongoose';
import type {
  MongoMemoryServer,
  MongoMemoryReplSet,
} from 'mongodb-memory-server';
import { startMemoryMongo, startMemoryReplSet } from '../../test/mongo.js';
import { playerRepository } from './playerRepository.js';
import {
  probeTransactionSupport,
  setTransactionSupportForTest,
  supportsTransactions,
  withTransaction,
} from './transactions.js';
import {
  commitInventories,
  createPlayer,
  persistPlayersNow,
} from '../services/player/playerService.js';
import { moveItem } from '../services/economy/economyService.js';
import {
  drainDirtyPlayerIds,
  markPlayerDirty,
  isPlayerCommitting,
} from './dirtyPlayers.js';
import { persistDirtyPlayers } from './playerSnapshot.js';
import { players } from '../sim/state.js';
import { registerPlayer, unregisterPlayer } from '../sim/world.js';
import { sendDelivery } from '../services/economy/deliveryService.js';
import { items } from '../services/content/itemService.js';
import DeliveryModel from '../model/Delivery.js';
import { logger } from '../logger.js';
import type { InventoryLike, PlayerServer } from '../../shared/types.js';

const SWORD = 7;

/** Two players, one holding the sword, both already in the database. */
async function tradingPair(): Promise<[PlayerServer, PlayerServer]> {
  const from = await createPlayer('Alice', 'hash');
  const to = await createPlayer('Bob', 'hash');
  from.inventory.items.push({ item: SWORD, quantity: 1 });
  await persistPlayersNow([from, to]);
  return [from, to];
}

/**
 * The first document is written for real and the second one fails.
 *
 * The real first write is the whole point: it is what has to be rolled back on
 * a replica set, and what stays behind without one. A stubbed no-op would make
 * both cases pass and prove nothing.
 */
function failSecondWrite(): void {
  const real = playerRepository.save.bind(playerRepository);
  vi.spyOn(playerRepository, 'save')
    .mockImplementationOnce(real)
    .mockRejectedValueOnce(new Error('connection lost'));
}

const swordToBob = ([alice, bob]: InventoryLike[]): boolean =>
  moveItem(alice!, bob!, SWORD, 1).ok;

const heldBy = async (name: string): Promise<number> => {
  const record = await playerRepository.findByName(name);
  const slot = record?.inventory.items.find((s) => Number(s.item) === SWORD);
  return slot?.quantity ?? 0;
};

beforeEach(async () => {
  const cols = mongoose.connection.collections;
  await Promise.all(Object.values(cols).map((c) => c.deleteMany({})));
  for (const id of Object.keys(players)) unregisterPlayer(id);
  drainDirtyPlayerIds();
  // Errors are the expected output of the abort tests; asserting on them is the
  // job of the assertions below, not of the console.
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe('standalone mongod', () => {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await startMemoryMongo();
    await mongoose.connect(mongod.getUri());
    await probeTransactionSupport();
  }, 60_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  it('reports that it cannot commit two documents together', () => {
    expect(supportsTransactions()).toBe(false);
  });

  it('refuses to open one instead of failing inside the driver', async () => {
    const work = vi.fn();
    expect(await withTransaction(work, 'test')).toBe(false);
    expect(work).not.toHaveBeenCalled();
  });

  it('still persists an economic commit, one write after the other', async () => {
    const [from, to] = await tradingPair();
    moveItem(from.inventory, to.inventory, SWORD, 1);

    await persistPlayersNow([from, to]);

    expect(await heldBy('Alice')).toBe(0);
    expect(await heldBy('Bob')).toBe(1);
  });

  it('leaves the trade half-written when the second write fails', async () => {
    // The documented consequence of no transactions, which the boot log
    // states. Here it is a fact of the suite and not a claim in a comment.
    const [from, to] = await tradingPair();
    moveItem(from.inventory, to.inventory, SWORD, 1);
    failSecondWrite();

    await persistPlayersNow([from, to]);

    expect(await heldBy('Alice')).toBe(0);
    expect(await heldBy('Bob')).toBe(0);
  });

  it('writes a half-landed inventory commit back from memory', async () => {
    const [from, to] = await tradingPair();
    registerPlayer(from);
    registerPlayer(to);
    failSecondWrite();

    expect(await commitInventories([from, to], swordToBob)).toBe(false);
    expect(await heldBy('Alice')).toBe(0);
    expect(from.inventory.items).toEqual([{ item: SWORD, quantity: 1 }]);

    await persistDirtyPlayers();
    expect(await heldBy('Alice')).toBe(1);
    expect(await heldBy('Bob')).toBe(0);
  });
});

describe('replica set', () => {
  let replset: MongoMemoryReplSet;

  beforeAll(async () => {
    replset = await startMemoryReplSet();
    await mongoose.connect(replset.getUri());
    await probeTransactionSupport();
  }, 60_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replset.stop();
  });

  it('detects the replica set from the deployment, not from config', () => {
    expect(supportsTransactions()).toBe(true);
  });

  it('commits both sides of a trade', async () => {
    const [from, to] = await tradingPair();
    moveItem(from.inventory, to.inventory, SWORD, 1);

    await persistPlayersNow([from, to]);

    expect(await heldBy('Alice')).toBe(0);
    expect(await heldBy('Bob')).toBe(1);
  });

  it('writes neither side when the second write fails', async () => {
    const [from, to] = await tradingPair();
    moveItem(from.inventory, to.inventory, SWORD, 1);
    failSecondWrite();

    await persistPlayersNow([from, to]);

    // The item is still Alice's: the trade did not happen, which is a state
    // the players can retry. "Bob has it and Alice still does" is not.
    expect(await heldBy('Alice')).toBe(1);
    expect(await heldBy('Bob')).toBe(0);
  });

  it('applies an inventory commit only once both sides are written', async () => {
    const [from, to] = await tradingPair();

    expect(await commitInventories([from, to], swordToBob)).toBe(true);

    expect(await heldBy('Alice')).toBe(0);
    expect(await heldBy('Bob')).toBe(1);
    expect(from.inventory.items).toEqual([]);
    expect(to.inventory.items).toEqual([{ item: SWORD, quantity: 1 }]);
  });

  it('leaves memory and disk as they were when an inventory commit fails', async () => {
    const [from, to] = await tradingPair();
    registerPlayer(from);
    registerPlayer(to);
    failSecondWrite();

    expect(await commitInventories([from, to], swordToBob)).toBe(false);
    expect(from.inventory.items).toEqual([{ item: SWORD, quantity: 1 }]);
    expect(to.inventory.items).toEqual([]);

    // Write-behind has nothing to save half of: memory never moved.
    await persistDirtyPlayers();
    expect(await heldBy('Alice')).toBe(1);
    expect(await heldBy('Bob')).toBe(0);
  });

  it('refuses an inventory commit for a player already committing', async () => {
    const [from, to] = await tradingPair();
    const change = vi.fn(swordToBob);

    const first = commitInventories([from, to], change);
    expect(await commitInventories([to, from], change)).toBe(false);
    expect(await first).toBe(true);
    expect(change).toHaveBeenCalledTimes(1);
  });

  it('does not let snapshots write half a trade after a presence refusal', async () => {
    const [from, to] = await tradingPair();
    registerPlayer(from);
    registerPlayer(to);
    moveItem(from.inventory, to.inventory, SWORD, 1);
    markPlayerDirty(from.id);
    markPlayerDirty(to.id);
    const real = playerRepository.save.bind(playerRepository);
    vi.spyOn(playerRepository, 'save').mockImplementation((player, session) =>
      player.id === from.id ? Promise.resolve(false) : real(player, session),
    );
    expect(await persistPlayersNow([from, to])).toBe(false);
    await persistDirtyPlayers();
    expect(await heldBy('Alice')).toBe(1);
    expect(await heldBy('Bob')).toBe(0);
  });

  // The other way a committed pair comes apart: write-behind writes each
  // dirty player alone, so a sweep during the commit could write one of the
  // two, and a crash there would tear the trade.
  it('holds the write-behind sweep off a pair being committed', async () => {
    const [from, to] = await tradingPair();
    moveItem(from.inventory, to.inventory, SWORD, 1);
    players[from.id] = from;
    players[to.id] = to;
    markPlayerDirty(from.id);
    markPlayerDirty(to.id);

    // Not awaited: the sweep runs while the transaction is open,
    // which is the window itself.
    const commit = persistPlayersNow([from, to]);
    await persistDirtyPlayers();

    // Both still pending: the sweep wrote neither, so nothing left the commit's
    // hands on its own.
    expect(drainDirtyPlayerIds().sort()).toEqual([from.id, to.id].sort());

    await commit;
    expect(await heldBy('Alice')).toBe(0);
    expect(await heldBy('Bob')).toBe(1);
  });

  it('still sweeps a player nobody is committing', async () => {
    const [from] = await tradingPair();
    players[from.id] = from;
    from.health = 21;
    markPlayerDirty(from.id);

    await persistDirtyPlayers();

    expect(drainDirtyPlayerIds()).toEqual([]);
    expect((await playerRepository.findByName('Alice'))!.health).toBe(21);
  });

  it('does not open a transaction for a single player', async () => {
    const [from] = await tradingPair();
    const start = vi.spyOn(mongoose, 'startSession');

    from.health = 42;
    await persistPlayersNow([from]);

    expect(start).not.toHaveBeenCalled();
    expect((await playerRepository.findByName('Alice'))!.health).toBe(42);
  });

  // The other pair of documents an economy write spans: the sender's
  // inventory and the queued row.
  it('debits the sender and queues the row together, or does neither', async () => {
    const alice = await createPlayer('Alice', 'hash');
    await createPlayer('Bob', 'hash');
    alice.inventory.items.push({ item: SWORD, quantity: 1 });
    await persistPlayersNow([alice]);
    items.set(SWORD, {
      id: SWORD,
      name: 'Sword',
      description: '',
      sprite: 0,
      type: 'weapon',
    });
    // Read from outside the session at the moment the row is written: this is
    // the crash window itself. Under a transaction the debit is invisible until
    // the row commits with it, so a process that dies here leaves the item with
    // Alice. Without one, that read sees the sword already gone.
    let visibleDuringRowWrite = -1;
    vi.spyOn(DeliveryModel, 'create').mockImplementationOnce(async () => {
      visibleDuringRowWrite = await heldBy('Alice');
      throw new Error('collection unavailable');
    });

    const result = await sendDelivery(alice, {
      to: 'Bob',
      itemId: SWORD,
      source: 'mail',
    });

    expect(visibleDuringRowWrite).toBe(1);
    expect(result).toEqual({ ok: false, reason: 'not-committed' });
    expect(await heldBy('Alice')).toBe(1);
    expect(alice.inventory.items).toEqual([{ item: SWORD, quantity: 1 }]);
    expect(await DeliveryModel.countDocuments({ to: 'Bob' })).toBe(0);
  });

  it('keeps a delivery debit out of the snapshot until its transaction commits', async () => {
    const [alice] = await tradingPair();
    registerPlayer(alice);
    items.set(SWORD, {
      id: SWORD,
      name: 'Sword',
      description: '',
      sprite: 0,
      type: 'weapon',
    });
    const real = playerRepository.save.bind(playerRepository);
    let swept = false;
    vi.spyOn(playerRepository, 'save').mockImplementation(
      async (player, session) => {
        if (session && !swept) {
          swept = true;
          markPlayerDirty(player.id);
          await persistDirtyPlayers();
        }
        return real(player, session);
      },
    );
    vi.spyOn(DeliveryModel, 'create').mockRejectedValueOnce(
      new Error('queue unavailable'),
    );
    expect(
      await sendDelivery(alice, { to: 'Bob', itemId: SWORD, source: 'mail' }),
    ).toEqual({ ok: false, reason: 'not-committed' });
    expect(await heldBy('Alice')).toBe(1);
    expect(alice.inventory.items).toEqual([{ item: SWORD, quantity: 1 }]);
  });

  it('aborts a delivery when the sender write is refused', async () => {
    const [alice] = await tradingPair();
    items.set(SWORD, {
      id: SWORD,
      name: 'Sword',
      description: '',
      sprite: 0,
      type: 'weapon',
    });
    vi.spyOn(playerRepository, 'save').mockResolvedValueOnce(false);
    expect(
      await sendDelivery(alice, { to: 'Bob', itemId: SWORD, source: 'mail' }),
    ).toEqual({ ok: false, reason: 'not-committed' });
    expect(await heldBy('Alice')).toBe(1);
    expect(await DeliveryModel.countDocuments({ to: 'Bob' })).toBe(0);
  });

  it('waits for an earlier snapshot before committing the sender debit', async () => {
    const [alice] = await tradingPair();
    registerPlayer(alice);
    items.set(SWORD, {
      id: SWORD,
      name: 'Sword',
      description: '',
      sprite: 0,
      type: 'weapon',
    });
    const real = playerRepository.save.bind(playerRepository);
    let release!: () => void;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writes: string[] = [];
    vi.spyOn(playerRepository, 'save')
      .mockImplementationOnce(async (player, session) => {
        await paused;
        writes.push('snapshot');
        return real(player, session);
      })
      .mockImplementation(async (player, session) => {
        writes.push('commit');
        return real(player, session);
      });
    markPlayerDirty(alice.id);
    const snapshot = persistDirtyPlayers();
    const sending = sendDelivery(alice, {
      to: 'Bob',
      itemId: SWORD,
      source: 'mail',
    });
    await vi.waitFor(() => expect(isPlayerCommitting(alice.id)).toBe(true));
    expect(writes).toEqual([]);
    release();
    await snapshot;
    expect((await sending).ok).toBe(true);
    expect(writes).toEqual(['snapshot', 'commit']);
    expect(await heldBy('Alice')).toBe(0);
    expect(await DeliveryModel.countDocuments({ to: 'Bob' })).toBe(1);
  });

  it('lets only one overlapping delivery debit the sender inventory', async () => {
    const [alice] = await tradingPair();
    items.set(SWORD, {
      id: SWORD,
      name: 'Sword',
      description: '',
      sprite: 0,
      type: 'weapon',
    });
    const results = await Promise.all([
      sendDelivery(alice, { to: 'Bob', itemId: SWORD, source: 'mail' }),
      sendDelivery(alice, { to: 'Bob', itemId: SWORD, source: 'mail' }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await heldBy('Alice')).toBe(0);
    expect(await DeliveryModel.countDocuments({ to: 'Bob' })).toBe(1);
  });

  it('falls back to independent writes when support is off', async () => {
    setTransactionSupportForTest(false);
    const [from, to] = await tradingPair();
    moveItem(from.inventory, to.inventory, SWORD, 1);

    await persistPlayersNow([from, to]);
    setTransactionSupportForTest(true);

    expect(await heldBy('Bob')).toBe(1);
  });
});
