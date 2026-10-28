/**
 * The delivery queue against a real (in-memory) MongoDB. An item owed to a
 * player is handed over exactly once, even if the process dies between the
 * two writes of a claim; that guarantee is the interaction between the
 * player document and the queue, so mocking either would test nothing.
 */
import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from 'vitest';
import mongoose from 'mongoose';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startMemoryMongo } from '../../../test/mongo.js';
import DeliveryModel from '../../model/Delivery.js';
import {
  cancelDelivery,
  claimDeliveries,
  countDeliveries,
  listDeliveries,
  queueDelivery,
  sendDelivery,
  sweepUnclaimableDeliveries,
} from './deliveryService.js';
import { deleteItem, items } from '../content/itemService.js';
import PlayerModel from '../../model/Player.js';
import {
  createPlayer,
  disconnectPlayer,
  getPlayerByNameFromDb,
  persistPlayerSessionState,
} from '../player/playerService.js';
import { players, playersByName } from '../../sim/state.js';
import { registerPlayer, unregisterPlayer } from '../../sim/world.js';
import type { PlayerServer } from '../../../shared/types.js';

// The database write is the half of a claim that can fail on its own, and
// what happens then is the whole design, so only this call fails on demand
// and the rest of playerService stays real.
const hooks = vi.hoisted(() => ({ persistFails: false }));
vi.mock('../player/playerService.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../player/playerService.js')>();
  return {
    ...actual,
    persistPlayerSessionState: async (player: PlayerServer) => {
      if (hooks.persistFails) throw new Error('database unavailable');
      return actual.persistPlayerSessionState(player);
    },
  };
});

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await startMemoryMongo();
  await mongoose.connect(mongod.getUri());
}, 30_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

const POTION = 1;
const SWORD = 2;

beforeEach(async () => {
  const cols = mongoose.connection.collections;
  await Promise.all(Object.values(cols).map((c) => c.deleteMany({})));
  for (const id of Object.keys(players)) unregisterPlayer(id);
  playersByName.clear();
  hooks.persistFails = false;
  items.clear();
  items.set(POTION, {
    id: POTION,
    name: 'Potion',
    description: '',
    sprite: 0,
    type: 'consumable',
  });
  items.set(SWORD, {
    id: SWORD,
    name: 'Sword',
    description: '',
    sprite: 1,
    type: 'weapon',
  });
});

/**
 * A player who exists in the database, as a recipient must, and is in the
 * world, as a sender must.
 */
async function makePlayer(name: string, capacity = 10): Promise<PlayerServer> {
  const player = await createPlayer(name, 'hash');
  player.inventory = { items: [], maxCapacity: capacity };
  registerPlayer(player);
  return player;
}

// Standalone MongoDB, an operator's own Mongo that is not a replica set: no
// transactions, so this is the degraded path. The atomic one is in
// persistence/transactions.test.ts, against a real replica set.
describe('sendDelivery without transactions', () => {
  const withSword = async (name: string): Promise<PlayerServer> => {
    const player = await makePlayer(name);
    player.inventory.items.push({ item: SWORD, quantity: 1 });
    return player;
  };

  it('debits the sender and queues the row', async () => {
    const alice = await withSword('Alice');
    await makePlayer('Bob');

    const result = await sendDelivery(alice, {
      to: 'Bob',
      itemId: SWORD,
      source: 'mail',
    });

    expect(result.ok).toBe(true);
    expect(alice.inventory.items).toEqual([]);
    expect(await countDeliveries('Bob')).toBe(1);
  });

  it('takes nothing when the recipient does not exist', async () => {
    const alice = await withSword('Alice');

    expect(
      await sendDelivery(alice, {
        to: 'Nobody',
        itemId: SWORD,
        source: 'mail',
      }),
    ).toEqual({ ok: false, reason: 'unknown-recipient' });
    expect(alice.inventory.items).toEqual([{ item: SWORD, quantity: 1 }]);
  });

  it('refuses what the sender no longer holds', async () => {
    const alice = await makePlayer('Alice');
    await makePlayer('Bob');

    expect(
      await sendDelivery(alice, { to: 'Bob', itemId: SWORD, source: 'mail' }),
    ).toEqual({ ok: false, reason: 'not-enough' });
    expect(await countDeliveries('Bob')).toBe(0);
  });

  it('queues nothing and keeps the item when the debit cannot be written', async () => {
    const alice = await withSword('Alice');
    await makePlayer('Bob');
    hooks.persistFails = true;

    const result = await sendDelivery(alice, {
      to: 'Bob',
      itemId: SWORD,
      source: 'mail',
    });

    expect(result).toEqual({ ok: false, reason: 'not-committed' });
    // The order is what makes this recoverable: no row exists, so the sender
    // keeping the item is the whole outcome.
    expect(alice.inventory.items).toEqual([{ item: SWORD, quantity: 1 }]);
    expect(await countDeliveries('Bob')).toBe(0);
  });

  it('refunds the sender when the row cannot be created after the debit', async () => {
    const alice = await withSword('Alice');
    await makePlayer('Bob');
    // What a reader sees while the row is written. The debit is already
    // durable, so a crash here loses the item, the window only a replica set
    // closes (persistence/transactions.test.ts reads 1).
    let visibleDuringRowWrite = -1;
    vi.spyOn(DeliveryModel, 'create').mockImplementationOnce(async () => {
      const record = await getPlayerByNameFromDb('Alice');
      visibleDuringRowWrite =
        record?.inventory.items.find((s) => Number(s.item) === SWORD)
          ?.quantity ?? 0;
      throw new Error('collection unavailable');
    });

    const result = await sendDelivery(alice, {
      to: 'Bob',
      itemId: SWORD,
      source: 'mail',
    });

    expect(visibleDuringRowWrite).toBe(0);
    expect(result).toEqual({ ok: false, reason: 'not-committed' });
    expect(alice.inventory.items).toEqual([{ item: SWORD, quantity: 1 }]);
    expect(await countDeliveries('Bob')).toBe(0);
    vi.restoreAllMocks();
  });

  it('takes nothing from a session that ended while the send was queued', async () => {
    const alice = await withSword('Alice');
    await makePlayer('Bob');

    const sending = sendDelivery(alice, {
      to: 'Bob',
      itemId: SWORD,
      source: 'mail',
    });
    // Out and back in before the send reached the inventory: the account is
    // another object now, loaded with the sword.
    unregisterPlayer(alice.id);
    const relogged = structuredClone(alice);
    registerPlayer(relogged);

    expect(await sending).toEqual({ ok: false, reason: 'not-committed' });
    expect(relogged.inventory.items).toEqual([{ item: SWORD, quantity: 1 }]);
    expect(await countDeliveries('Bob')).toBe(0);
  });

  it('takes the fee with the item, or neither', async () => {
    const postage = { itemId: POTION, quantity: 10 };
    const alice = await withSword('Alice');
    alice.inventory.items.push({ item: POTION, quantity: 5 });
    await makePlayer('Bob');

    expect(
      await sendDelivery(alice, {
        to: 'Bob',
        itemId: SWORD,
        source: 'mail',
        fee: postage,
      }),
    ).toEqual({ ok: false, reason: 'not-enough' });
    expect(alice.inventory.items).toEqual([
      { item: SWORD, quantity: 1 },
      { item: POTION, quantity: 5 },
    ]);

    alice.inventory.items[1]!.quantity = 15;
    expect(
      (
        await sendDelivery(alice, {
          to: 'Bob',
          itemId: SWORD,
          source: 'mail',
          fee: postage,
        })
      ).ok,
    ).toBe(true);
    expect(alice.inventory.items).toEqual([{ item: POTION, quantity: 5 }]);
  });
});

describe('queueDelivery', () => {
  it('queues for a player who is offline', async () => {
    await makePlayer('Alice');

    const result = await queueDelivery({
      to: 'Alice',
      itemId: POTION,
      quantity: 2,
      source: 'test',
    });

    expect(result.ok).toBe(true);
    expect(await countDeliveries('Alice')).toBe(1);
  });

  // A row nobody can ever claim is worse than a refused send: the sender is
  // debited and the item is gone.
  it('refuses a recipient that does not exist', async () => {
    const result = await queueDelivery({
      to: 'Nobody',
      itemId: POTION,
      source: 'test',
    });

    expect(result).toEqual({ ok: false, reason: 'unknown-recipient' });
    expect(await countDeliveries('Nobody')).toBe(0);
  });

  it('refuses an item the catalogue does not define', async () => {
    await makePlayer('Alice');

    expect(
      await queueDelivery({ to: 'Alice', itemId: 999, source: 'test' }),
    ).toEqual({ ok: false, reason: 'unknown-item' });
  });

  it('refuses a non-positive quantity', async () => {
    await makePlayer('Alice');

    expect(
      await queueDelivery({
        to: 'Alice',
        itemId: POTION,
        quantity: 0,
        source: 'test',
      }),
    ).toEqual({ ok: false, reason: 'invalid-amount' });
  });

  it('caps what one recipient can hold, so the queue cannot grow forever', async () => {
    await makePlayer('Alice');
    for (let i = 0; i < 100; i++) {
      await queueDelivery({ to: 'Alice', itemId: POTION, source: 'test' });
    }

    const overflow = await queueDelivery({
      to: 'Alice',
      itemId: POTION,
      source: 'test',
    });

    expect(overflow).toEqual({ ok: false, reason: 'mailbox-full' });
    expect(await countDeliveries('Alice')).toBe(100);
  });

  it('holds the cap against sends counted at the same time', async () => {
    await makePlayer('Alice');
    for (let i = 0; i < 99; i++) {
      await queueDelivery({ to: 'Alice', itemId: POTION, source: 'test' });
    }

    const results = await Promise.all(
      [1, 2, 3].map(() =>
        queueDelivery({ to: 'Alice', itemId: POTION, source: 'test' }),
      ),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await countDeliveries('Alice')).toBe(100);
  });

  it('refuses a payload over the stored-value limit', async () => {
    await makePlayer('Alice');

    const result = await queueDelivery({
      to: 'Alice',
      itemId: POTION,
      source: 'test',
      meta: { message: 'x'.repeat(100_000) },
    });

    expect(result).toEqual({ ok: false, reason: 'meta-too-large' });
  });

  it('keeps what the sender attached, for the module to render', async () => {
    await makePlayer('Alice');
    await queueDelivery({
      to: 'Alice',
      itemId: SWORD,
      source: 'mail',
      meta: { from: 'Bob', message: 'happy birthday' },
    });

    const [row] = await listDeliveries('Alice');
    expect(row).toMatchObject({
      itemId: SWORD,
      quantity: 1,
      source: 'mail',
      meta: { from: 'Bob', message: 'happy birthday' },
    });
  });
});

describe('a keyed delivery', () => {
  it('is queued once, even after its row was claimed', async () => {
    await DeliveryModel.init();
    const alice = await makePlayer('Alice');
    const input = { to: 'Alice', itemId: SWORD, source: 'quest', key: 'k' };

    const first = await queueDelivery(input);
    expect(await queueDelivery(input)).toEqual(first);
    await claimDeliveries(alice);
    expect(await queueDelivery(input)).toEqual(first);

    expect(alice.inventory.items).toEqual([{ item: SWORD, quantity: 1 }]);
    expect(await countDeliveries('Alice')).toBe(0);
    expect(await cancelDelivery((first as { id: string }).id)).toBe(false);
  });
});

describe('claimDeliveries', () => {
  it('moves the item into the inventory and clears the row', async () => {
    const alice = await makePlayer('Alice');
    await queueDelivery({
      to: 'Alice',
      itemId: POTION,
      quantity: 3,
      source: 'test',
    });

    const outcomes = await claimDeliveries(alice);

    expect(outcomes).toEqual([{ id: expect.any(String), ok: true }]);
    expect(alice.inventory.items).toEqual([{ item: POTION, quantity: 3 }]);
    expect(await countDeliveries('Alice')).toBe(0);
  });

  it('persists the inventory with the claim, not just in memory', async () => {
    const alice = await makePlayer('Alice');
    await queueDelivery({ to: 'Alice', itemId: SWORD, source: 'test' });

    await claimDeliveries(alice);

    const stored = await getPlayerByNameFromDb('Alice');
    expect(stored?.inventory.items).toEqual([{ item: SWORD, quantity: 1 }]);
  });

  // The reason the claimed id is recorded on the player document at all: if the
  // row deletion fails (or the process dies right after the player is saved),
  // the next claim must not hand the item over a second time.
  it('does not deliver twice when the row outlives the claim', async () => {
    const alice = await makePlayer('Alice');
    const queued = await queueDelivery({
      to: 'Alice',
      itemId: SWORD,
      source: 'test',
    });
    await claimDeliveries(alice);

    // Exactly the state a crash between the two writes leaves behind.
    await DeliveryModel.create({
      id: queued.ok ? queued.id : '',
      to: 'Alice',
      itemId: SWORD,
      quantity: 1,
      source: 'test',
      createdAt: Date.now(),
    });

    const outcomes = await claimDeliveries(alice);

    expect(outcomes).toEqual([{ id: expect.any(String), ok: true }]);
    expect(alice.inventory.items).toEqual([{ item: SWORD, quantity: 1 }]);
    expect(await countDeliveries('Alice')).toBe(0);
  });

  // A full mailbox settled in one claim: the record has to cover every row a
  // failed delete leaves behind, and keep covering them through the retries.
  it('does not deliver twice when a full mailbox outlives the claim', async () => {
    const alice = await makePlayer('Alice');
    await DeliveryModel.insertMany(
      Array.from({ length: 100 }, (_, i) => ({
        id: `row-${i}`,
        to: 'Alice',
        itemId: POTION,
        quantity: 1,
        source: 'test',
        createdAt: i,
      })),
    );

    const deleteMany = vi
      .spyOn(DeliveryModel, 'deleteMany')
      .mockRejectedValue(new Error('database unavailable'));
    await claimDeliveries(alice);
    await claimDeliveries(alice);
    deleteMany.mockRestore();
    await claimDeliveries(alice);

    expect(alice.inventory.items).toEqual([{ item: POTION, quantity: 100 }]);
    const stored = await getPlayerByNameFromDb('Alice');
    expect(stored?.inventory.items).toEqual([{ item: POTION, quantity: 100 }]);
    expect(await countDeliveries('Alice')).toBe(0);
  });

  // The mirror case: the write that carries both the item and the record of
  // the claim never landed, so the item is still owed and the row must survive.
  it('keeps the row when the player could not be saved', async () => {
    const alice = await makePlayer('Alice');
    await queueDelivery({ to: 'Alice', itemId: SWORD, source: 'test' });

    hooks.persistFails = true;
    await claimDeliveries(alice);

    expect(await countDeliveries('Alice')).toBe(1);
  });

  it('redelivers exactly once after that failure', async () => {
    const alice = await makePlayer('Alice');
    await queueDelivery({ to: 'Alice', itemId: SWORD, source: 'test' });

    hooks.persistFails = true;
    await claimDeliveries(alice);

    // What the process comes back as: the in-memory inventory and the claim
    // record died with it, and the row is the only thing that remembers.
    const restarted = { ...alice, inventory: { items: [], maxCapacity: 10 } };
    delete restarted.data;
    unregisterPlayer(alice.id);
    registerPlayer(restarted);
    hooks.persistFails = false;

    await claimDeliveries(restarted);
    expect(restarted.inventory.items).toEqual([{ item: SWORD, quantity: 1 }]);

    // And a second attempt on the recovered state adds nothing.
    await claimDeliveries(restarted);
    expect(restarted.inventory.items).toEqual([{ item: SWORD, quantity: 1 }]);
    expect(await countDeliveries('Alice')).toBe(0);
  });

  it('leaves a row queued when the inventory is full', async () => {
    const alice = await makePlayer('Alice', 1);
    alice.inventory.items = [{ item: SWORD, quantity: 1 }];
    await queueDelivery({ to: 'Alice', itemId: POTION, source: 'test' });

    const outcomes = await claimDeliveries(alice);

    expect(outcomes).toEqual([
      { id: expect.any(String), ok: false, reason: 'no-space' },
    ]);
    expect(await countDeliveries('Alice')).toBe(1);
  });

  // A full bag for one item says nothing about the next: a stack that is
  // already held always fits.
  it('takes what fits and keeps the rest waiting', async () => {
    const alice = await makePlayer('Alice', 1);
    alice.inventory.items = [{ item: POTION, quantity: 1 }];
    await queueDelivery({ to: 'Alice', itemId: SWORD, source: 'test' });
    await queueDelivery({ to: 'Alice', itemId: POTION, source: 'test' });

    const outcomes = await claimDeliveries(alice);

    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    expect(alice.inventory.items).toEqual([{ item: POTION, quantity: 2 }]);
    expect(await countDeliveries('Alice')).toBe(1);
  });

  it('claims only the ids asked for', async () => {
    const alice = await makePlayer('Alice');
    const first = await queueDelivery({
      to: 'Alice',
      itemId: POTION,
      source: 'test',
    });
    await queueDelivery({ to: 'Alice', itemId: SWORD, source: 'test' });

    await claimDeliveries(alice, first.ok ? [first.id] : []);

    expect(alice.inventory.items).toEqual([{ item: POTION, quantity: 1 }]);
    expect(await countDeliveries('Alice')).toBe(1);
  });

  // An item deleted from the catalogue after the row was queued would put an
  // unresolvable entry in the inventory and break the player's stats
  // payload, so it stays queued.
  it('refuses a row whose item no longer exists', async () => {
    const alice = await makePlayer('Alice');
    await queueDelivery({ to: 'Alice', itemId: SWORD, source: 'test' });
    items.delete(SWORD);

    const outcomes = await claimDeliveries(alice);

    expect(outcomes).toEqual([
      { id: expect.any(String), ok: false, reason: 'unknown-item' },
    ]);
    expect(alice.inventory.items).toEqual([]);
    expect(await countDeliveries('Alice')).toBe(1);
  });

  it('is a no-op when nothing is waiting', async () => {
    const alice = await makePlayer('Alice');
    expect(await claimDeliveries(alice)).toEqual([]);
  });

  // The claim record only covers rows still queued, so a claim whose listing
  // predates another claim's delete can find a row it no longer recognises.
  it('hands each row over once when claims overlap', async () => {
    const alice = await makePlayer('Alice');
    const sword = await queueDelivery({
      to: 'Alice',
      itemId: SWORD,
      source: 'test',
    });
    await queueDelivery({ to: 'Alice', itemId: POTION, source: 'test' });
    const rows = await listDeliveries('Alice');

    let release!: () => void;
    const answered = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(DeliveryModel, 'find').mockImplementationOnce(
      () =>
        ({
          sort: () => ({
            lean: () => ({ exec: () => answered.then(() => rows) }),
          }),
        }) as never,
    );
    const late = claimDeliveries(alice);
    const others = claimDeliveries(alice, sword.ok ? [sword.id] : []).then(() =>
      claimDeliveries(alice),
    );
    await Promise.race([others, new Promise((r) => setTimeout(r, 200))]);
    release();
    await Promise.all([late, others]);

    expect(alice.inventory.items).toEqual([
      { item: SWORD, quantity: 1 },
      { item: POTION, quantity: 1 },
    ]);
  });

  // A snapshot write carries the state it was cast from; landing after the
  // claim it would erase the item whose row the claim has already deleted.
  it('lets a write already in flight land before the claim', async () => {
    const alice = await makePlayer('Alice');
    await queueDelivery({ to: 'Alice', itemId: SWORD, source: 'test' });

    let release!: () => void;
    const landed = new Promise<void>((resolve) => (release = resolve));
    const findOneAndUpdate = PlayerModel.findOneAndUpdate.bind(PlayerModel);
    vi.spyOn(PlayerModel, 'findOneAndUpdate').mockImplementationOnce(((
      filter: object,
      update: object,
      options: object,
    ) => {
      const cast = structuredClone(update);
      return landed.then(() => findOneAndUpdate(filter, cast, options));
    }) as never);
    const snapshot = persistPlayerSessionState(alice);
    const claim = claimDeliveries(alice);
    await new Promise((r) => setTimeout(r, 100));
    release();
    await Promise.all([snapshot, claim]);

    const stored = await getPlayerByNameFromDb('Alice');
    expect(stored?.inventory.items).toEqual([{ item: SWORD, quantity: 1 }]);
  });

  // A claim queued behind another outlives a logout that waits for the first
  // only. An item added after the last write lands in a document the next
  // session has already loaded, and that session's save erases it.
  it('hands an item over once when a claim waits through a logout', async () => {
    const alice = await makePlayer('Alice');
    const sword = await queueDelivery({
      to: 'Alice',
      itemId: SWORD,
      source: 'test',
    });
    const potion = await queueDelivery({
      to: 'Alice',
      itemId: POTION,
      source: 'test',
    });

    // Each listing waits for its gate, then reads the queue as it is by then.
    const find = DeliveryModel.find.bind(DeliveryModel);
    const gated = (gate: Promise<void>) => (filter: object) => ({
      sort: (order: Record<string, 1 | -1>) => ({
        lean: () => ({
          exec: () => gate.then(() => find(filter).sort(order).lean().exec()),
        }),
      }),
    });
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => (releaseFirst = resolve));
    let releaseSecond!: () => void;
    const second = new Promise<void>((resolve) => (releaseSecond = resolve));
    vi.spyOn(DeliveryModel, 'find')
      .mockImplementationOnce(gated(first) as never)
      .mockImplementationOnce(gated(second) as never);

    const claimSword = claimDeliveries(alice, sword.ok ? [sword.id] : []);
    const claimPotion = claimDeliveries(alice, potion.ok ? [potion.id] : []);
    const logout = disconnectPlayer('Alice');
    // The next session starts from the document the logout left.
    const next = logout.then(async () => {
      const { password: _pw, ...stored } =
        (await getPlayerByNameFromDb('Alice'))!;
      registerPlayer(stored);
      return stored;
    });
    // The second listing answers once the next session is in, or after a
    // while, should the logout be waiting on that claim.
    void next.then(releaseSecond);
    setTimeout(releaseSecond, 100);
    releaseFirst();
    await Promise.all([claimSword, claimPotion, logout]);
    const session = await next;

    await persistPlayerSessionState(session);
    await claimDeliveries(session);

    const stored = await getPlayerByNameFromDb('Alice');
    expect(stored?.inventory.items).toEqual([
      { item: SWORD, quantity: 1 },
      { item: POTION, quantity: 1 },
    ]);
    expect(await countDeliveries('Alice')).toBe(0);
  });
});

describe('cancelDelivery', () => {
  it('drops a row without delivering it', async () => {
    const alice = await makePlayer('Alice');
    const queued = await queueDelivery({
      to: 'Alice',
      itemId: POTION,
      source: 'test',
    });

    expect(await cancelDelivery(queued.ok ? queued.id : '')).toBe(true);
    expect(await countDeliveries('Alice')).toBe(0);
    expect(alice.inventory.items).toEqual([]);
  });

  it('reports an id that was not there', async () => {
    expect(await cancelDelivery('nope')).toBe(false);
  });
});

// A row whose item left the catalogue can never be claimed (see the claim test
// above), so nobody frees the slot it holds unless something drops it.
describe('sweepUnclaimableDeliveries', () => {
  const queueBoth = async () => {
    await makePlayer('Alice');
    await queueDelivery({ to: 'Alice', itemId: POTION, source: 'test' });
    await queueDelivery({ to: 'Alice', itemId: SWORD, source: 'test' });
  };

  it('drops the rows owing a deleted item and keeps the rest', async () => {
    await queueBoth();
    items.delete(SWORD);

    expect(await sweepUnclaimableDeliveries()).toBe(1);
    expect((await listDeliveries('Alice')).map((r) => r.itemId)).toEqual([
      POTION,
    ]);
  });

  it('keeps every row when the catalogue is empty', async () => {
    await queueBoth();
    // Content that failed to load, not a catalogue where everything was
    // deleted: sweeping on this would empty every mailbox in the game.
    items.clear();

    expect(await sweepUnclaimableDeliveries()).toBe(0);
    expect(await countDeliveries('Alice')).toBe(2);
  });

  it('runs when an item is deleted from the catalogue', async () => {
    await queueBoth();

    await deleteItem(SWORD);

    expect((await listDeliveries('Alice')).map((r) => r.itemId)).toEqual([
      POTION,
    ]);
  });
});
