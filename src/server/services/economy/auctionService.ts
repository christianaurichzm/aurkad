import crypto from 'node:crypto';
import AuctionModel from '../../model/Auction.js';
import {
  supportsTransactions,
  withTransaction,
} from '../../persistence/transactions.js';
import {
  beginPlayerCommit,
  endPlayerCommit,
  isPlayerCommitting,
} from '../../persistence/dirtyPlayers.js';
import {
  persistPlayerSessionState,
  waitForPlayerPersistence,
} from '../player/playerService.js';
import { getItemById } from '../content/itemService.js';
import {
  exchangeItems,
  removeItem,
  lockInventory,
  unlockInventory,
} from './economyService.js';
import { queueDelivery } from './deliveryService.js';
import { updatePlayer } from '../../sim/world.js';
import type { PlayerServer } from '../../../shared/types.js';

export interface AuctionListing {
  id: string;
  state: 'active' | 'unpaid';
  seller: string;
  itemId: number;
  quantity: number;
  price: number;
  listedAt: number;
  expiresAt: number;
  currencyItemId?: number;
  payout?: number;
}
export type AuctionFailure =
  | 'not-committed'
  | 'transactions-required'
  | 'busy'
  | 'unknown-item'
  | 'bound'
  | 'invalid-amount'
  | 'not-enough'
  | 'no-space'
  | 'limit'
  | 'missing'
  | 'not-yours'
  | 'own-listing'
  | 'mailbox-full';
export type AuctionResult =
  { ok: true; listing: AuctionListing } | { ok: false; reason: AuctionFailure };
const fail = (reason: AuctionFailure): AuctionResult => ({ ok: false, reason });

export async function listAuctions(): Promise<AuctionListing[]> {
  return AuctionModel.find({ state: 'active', expiresAt: { $gt: Date.now() } })
    .sort({ listedAt: 1 })
    .lean<AuctionListing[]>()
    .exec();
}

export async function createAuction(
  player: PlayerServer,
  input: {
    itemId: number;
    quantity: number;
    price: number;
    durationMs: number;
    maxListings: number;
  },
): Promise<AuctionResult> {
  if (!supportsTransactions()) return fail('transactions-required');
  if (isPlayerCommitting(player.id)) return fail('busy');
  const item = getItemById(input.itemId);
  if (!item) return fail('unknown-item');
  if (item.bound) return fail('bound');
  if (
    ![input.quantity, input.price, input.maxListings].every(
      (n) => Number.isSafeInteger(n) && n > 0,
    ) ||
    !Number.isFinite(input.durationMs) ||
    input.durationMs <= 0
  )
    return fail('invalid-amount');
  const listing: AuctionListing = {
    id: crypto.randomUUID(),
    state: 'active',
    seller: player.name,
    itemId: input.itemId,
    quantity: input.quantity,
    price: input.price,
    listedAt: Date.now(),
    expiresAt: Date.now() + input.durationMs,
  };
  beginPlayerCommit([player.id]);
  lockInventory(player.inventory);
  try {
    await waitForPlayerPersistence(player.id);
    const inventory = structuredClone(player.inventory);
    if (!removeItem(inventory, input.itemId, input.quantity).ok)
      return fail('not-enough');
    let result: AuctionResult = fail('not-committed');
    const committed = await withTransaction(async (session) => {
      result = fail('not-committed');
      if (
        (await AuctionModel.countDocuments({ seller: player.name }).session(
          session,
        )) >= input.maxListings
      ) {
        result = fail('limit');
        return;
      }
      await persistPlayerSessionState({ ...player, inventory }, session);
      await AuctionModel.create([listing], { session });
      result = { ok: true, listing };
    }, `auction list: ${player.name}`);
    if (!committed) return fail('not-committed');
    if (result.ok) {
      player.inventory.items = inventory.items;
      updatePlayer(player);
    }
    return result;
  } finally {
    unlockInventory(player.inventory);
    endPlayerCommit([player.id]);
  }
}

// Payment and removal of the debt share a transaction. A restart or an
// overlapping sweep sees either the debt or the delivery, never both.
export async function settleAuction(id: string): Promise<boolean> {
  let paid = false;
  const committed = await withTransaction(async (session) => {
    paid = false;
    const listing = await AuctionModel.findOne({ id, state: 'unpaid' })
      .session(session)
      .lean<AuctionListing>();
    if (!listing) return;
    if ((listing.payout ?? 0) > 0) {
      const delivery = await queueDelivery(
        {
          to: listing.seller,
          itemId: listing.currencyItemId!,
          quantity: listing.payout,
          source: 'auction',
        },
        session,
      );
      if (!delivery.ok) return;
    }
    await AuctionModel.deleteOne({ id, state: 'unpaid' }, { session });
    paid = true;
  }, `auction payment: ${id}`);
  return committed && paid;
}

export async function buyAuction(
  player: PlayerServer,
  id: string,
  currencyItemId: number,
  feePercent: number,
): Promise<AuctionResult> {
  if (!supportsTransactions()) return fail('transactions-required');
  if (isPlayerCommitting(player.id)) return fail('busy');
  if (
    !getItemById(currencyItemId) ||
    !Number.isFinite(feePercent) ||
    feePercent < 0 ||
    feePercent > 90
  )
    return fail('invalid-amount');
  beginPlayerCommit([player.id]);
  lockInventory(player.inventory);
  try {
    await waitForPlayerPersistence(player.id);
    let result: AuctionResult = fail('not-committed');
    let inventory = structuredClone(player.inventory);
    const committed = await withTransaction(async (session) => {
      result = fail('not-committed');
      inventory = structuredClone(player.inventory);
      const listing = await AuctionModel.findOne({
        id,
        state: 'active',
        expiresAt: { $gt: Date.now() },
      })
        .session(session)
        .lean<AuctionListing>();
      if (!listing) {
        result = fail('missing');
        return;
      }
      if (listing.seller === player.name) {
        result = fail('own-listing');
        return;
      }
      if (!getItemById(listing.itemId)) {
        result = fail('unknown-item');
        return;
      }
      const exchanged = exchangeItems(
        inventory,
        [{ itemId: currencyItemId, quantity: listing.price }],
        { itemId: listing.itemId, quantity: listing.quantity },
      );
      if (!exchanged.ok) {
        result = fail(
          exchanged.reason === 'no-space' ? 'no-space' : 'not-enough',
        );
        return;
      }
      const payout =
        listing.price - Math.floor((listing.price * feePercent) / 100);
      await AuctionModel.updateOne(
        { id, state: 'active' },
        { $set: { state: 'unpaid', currencyItemId, payout } },
        { session },
      );
      await persistPlayerSessionState({ ...player, inventory }, session);
      result = {
        ok: true,
        listing: { ...listing, state: 'unpaid', currencyItemId, payout },
      };
    }, `auction buy: ${player.name}/${id}`);
    if (!committed) return fail('not-committed');
    if (result.ok) {
      player.inventory.items = inventory.items;
      updatePlayer(player);
    }
    if (result.ok) await settleAuction(id);
    return result;
  } finally {
    unlockInventory(player.inventory);
    endPlayerCommit([player.id]);
  }
}

export async function returnAuction(
  id: string,
  seller?: string,
): Promise<AuctionResult> {
  if (!supportsTransactions()) return fail('transactions-required');
  let result: AuctionResult = fail('not-committed');
  const committed = await withTransaction(async (session) => {
    result = fail('not-committed');
    const listing = await AuctionModel.findOne({ id, state: 'active' })
      .session(session)
      .lean<AuctionListing>();
    if (!listing) {
      result = fail('missing');
      return;
    }
    if (seller !== undefined && listing.seller !== seller) {
      result = fail('not-yours');
      return;
    }
    const delivery = await queueDelivery(
      {
        to: listing.seller,
        itemId: listing.itemId,
        quantity: listing.quantity,
        source: 'auction',
      },
      session,
    );
    if (!delivery.ok) {
      result = fail(
        delivery.reason === 'mailbox-full' ? 'mailbox-full' : 'not-committed',
      );
      return;
    }
    await AuctionModel.deleteOne({ id, state: 'active' }, { session });
    result = { ok: true, listing };
  }, `auction return: ${id}`);
  return committed ? result : fail('not-committed');
}

/**
 * Drops every listing of `seller`, sold or not, and says how many: an
 * erased account takes its goods and its takings with it, which left here
 * would go to whoever registers the name next.
 */
export async function dropListingsOf(seller: string): Promise<number> {
  const { deletedCount } = await AuctionModel.deleteMany({ seller });
  return deletedCount;
}

export async function sweepAuctions(): Promise<void> {
  if (!supportsTransactions()) return;
  const rows = await AuctionModel.find({
    $or: [
      { state: 'unpaid' },
      { state: 'active', expiresAt: { $lte: Date.now() } },
    ],
  })
    .select({ id: 1, state: 1 })
    .lean<{ id: string; state: string }[]>();
  for (const row of rows) {
    if (row.state === 'unpaid') await settleAuction(row.id);
    else await returnAuction(row.id);
  }
}
