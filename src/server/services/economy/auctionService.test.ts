/**
 * Auction returns against a real (in-memory) replica set. A return queues the
 * item back to the seller inside its transaction, so the seller's pending cap
 * has to hold while that row is written but not yet committed, which no mock
 * of the transaction can show.
 */
import { beforeAll, afterAll, afterEach, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { startMemoryReplSet } from '../../../test/mongo.js';
import { probeTransactionSupport } from '../../persistence/transactions.js';
import AuctionModel from '../../model/Auction.js';
import DeliveryModel from '../../model/Delivery.js';
import DeliveryGuardModel from '../../model/DeliveryGuard.js';
import { createPlayer } from '../player/playerService.js';
import { items } from '../content/itemService.js';
import { returnAuction } from './auctionService.js';
import { queueDelivery, PENDING } from './deliveryService.js';

const SWORD = 1;
let replset: MongoMemoryReplSet;

beforeAll(async () => {
  replset = await startMemoryReplSet();
  await mongoose.connect(replset.getUri());
  await probeTransactionSupport();
  await Promise.all(
    [AuctionModel, DeliveryModel, DeliveryGuardModel].map((m) => m.init()),
  );
  items.set(SWORD, {
    id: SWORD,
    name: 'Sword',
    description: '',
    sprite: 0,
    type: 'weapon',
  });
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replset.stop();
});

afterEach(async () => {
  vi.restoreAllMocks();
  const cols = mongoose.connection.collections;
  await Promise.all(Object.values(cols).map((c) => c.deleteMany({})));
});

/** A seller one row short of a full mailbox, with two listings to return. */
async function sellerOneShortOfFull(): Promise<[string, string]> {
  await createPlayer('Seller', 'hash');
  await DeliveryModel.insertMany(
    Array.from({ length: 99 }, (_, i) => ({
      id: `full-${i}`,
      to: 'Seller',
      itemId: SWORD,
      quantity: 1,
      source: 'test',
      createdAt: Date.now(),
    })),
  );
  const ids: [string, string] = ['listing-a', 'listing-b'];
  await AuctionModel.insertMany(
    ids.map((id) => ({
      id,
      state: 'active',
      seller: 'Seller',
      itemId: SWORD,
      quantity: 1,
      price: 1,
      listedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    })),
  );
  return ids;
}

/**
 * Starts a return and stops it after its delivery row is written, before its
 * transaction commits, until `release` is called.
 */
async function returnHeldBeforeCommit(id: string) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let reached!: () => void;
  const atDelete = new Promise<void>((resolve) => (reached = resolve));
  const deleteOne = AuctionModel.deleteOne.bind(AuctionModel);
  vi.spyOn(AuctionModel, 'deleteOne').mockImplementationOnce(((
    ...args: Parameters<typeof deleteOne>
  ) => {
    reached();
    return held.then(() => deleteOne(...args));
  }) as never);
  const result = returnAuction(id);
  await atDelete;
  return { result, release };
}

/** Long enough for a send nothing holds back to finish. */
const settled = (send: Promise<unknown>) =>
  Promise.race([send, new Promise((resolve) => setTimeout(resolve, 300))]);

it('holds the seller cap against a return that has not committed yet', async () => {
  const [a, b] = await sellerOneShortOfFull();
  const first = await returnHeldBeforeCommit(a);

  const second = returnAuction(b);
  await settled(second);
  first.release();

  expect(await first.result).toMatchObject({ ok: true });
  expect(await second).toEqual({ ok: false, reason: 'mailbox-full' });
  expect(await DeliveryModel.countDocuments({ to: 'Seller', ...PENDING })).toBe(
    100,
  );
  expect(await AuctionModel.countDocuments({ id: b })).toBe(1);
});

it('holds it against a send outside a transaction too', async () => {
  const [a] = await sellerOneShortOfFull();
  const first = await returnHeldBeforeCommit(a);

  const grant = queueDelivery({ to: 'Seller', itemId: SWORD, source: 'test' });
  await settled(grant);
  first.release();

  expect(await first.result).toMatchObject({ ok: true });
  expect(await grant).toEqual({ ok: false, reason: 'mailbox-full' });
  expect(await DeliveryModel.countDocuments({ to: 'Seller', ...PENDING })).toBe(
    100,
  );
});
