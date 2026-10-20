// Handing an item to a player who may not be online. Writing into the
// recipient's document loses items: an online player's document is
// rewritten from memory by the snapshot loop, and a login can start
// between the online check and the write. So a delivery is a row in its
// own collection, claimed into the inventory when they are online.
//
// - **Exactly once.** The claim adds the item and records the claimed id on
//   the player document in one write, so a crash loses both (the row
//   survives and is redelivered) or keeps both (the row is deleted, or the
//   recorded id makes the next claim skip it). Plain add-then-delete cannot
//   promise that without transactions.
// - **Bounded.** Each recipient has a pending cap and the payload a size
//   cap, or an unclaimed queue grows without end.
//
// Core rather than a module, as the item conservation boundary for an
// asynchronous transfer that `game.json` must not switch off. The mailbox
// on top (who may send, the message, the expiry) is the module.

import crypto from 'node:crypto';
import type { ClientSession } from 'mongoose';
import DeliveryModel from '../../model/Delivery.js';
import {
  addItem,
  removeItem,
  lockInventory,
  unlockInventory,
} from './economyService.js';
import {
  supportsTransactions,
  withTransaction,
} from '../../persistence/transactions.js';
import { getItemById, items } from '../content/itemService.js';
import {
  getPlayerById,
  getPlayerByName,
  updatePlayer,
} from '../../sim/world.js';
import {
  getPlayerByNameFromDb,
  persistPlayerSessionState,
  waitForPlayerPersistence,
} from '../player/playerService.js';
import { measureValue } from '../../persistence/dataLimits.js';
import { logger } from '../../logger.js';
import type { PlayerServer } from '../../../shared/types.js';
import {
  beginPlayerCommit,
  endPlayerCommit,
  isPlayerCommitting,
  waitForPlayerCommit,
} from '../../persistence/dirtyPlayers.js';

/**
 * Pending rows one recipient may hold. The cap is the recipient's, so one
 * player cannot fill another's queue and the rows per player stay bounded
 * however long they stay away.
 */
const MAX_PENDING_PER_PLAYER = 100;

/**
 * The tail of each recipient's queue of sends.
 *
 * The cap is a count followed by an insert, so two sends counted before
 * either inserts both fit. Sends to one recipient therefore run one after the
 * other, from the count to the insert.
 *
 * In-process only: two instances sending to one recipient can still pass the
 * cap together. Closing that across instances takes a per-recipient counter
 * document with a conditional $inc.
 */
const recipientTails = new Map<string, Promise<unknown>>();

function oneSendAtATime<T>(to: string, send: () => Promise<T>): Promise<T> {
  const result = (recipientTails.get(to) ?? Promise.resolve()).then(send, send);
  const tail = result.catch(() => undefined);
  recipientTails.set(to, tail);
  void tail.then(() => {
    if (recipientTails.get(to) === tail) recipientTails.delete(to);
  });
  return result;
}

/** Engine-owned key in the player's data bag, not a script's to manage. */
const CLAIMED_KEY = '__claimedDeliveries';

export interface PendingDelivery {
  id: string;
  to: string;
  itemId: number;
  quantity: number;
  source: string;
  meta?: unknown;
  createdAt: number;
}

export type DeliveryFailure =
  | 'invalid-amount'
  | 'unknown-item'
  | 'unknown-recipient'
  | 'mailbox-full'
  | 'meta-too-large'
  | 'not-enough'
  /** The write failed: nothing was queued and the sender keeps the item. */
  | 'not-committed';

export type QueueResult =
  { ok: true; id: string } | { ok: false; reason: DeliveryFailure };

export type ClaimOutcome =
  | { id: string; ok: true }
  | { id: string; ok: false; reason: 'no-space' | 'unknown-item' };

export interface DeliveryInput {
  to: string;
  itemId: number;
  quantity?: number;
  /** Module or script queueing it; recorded for auditing. */
  source: string;
  meta?: unknown;
}

/** What the sender pays on top of the item, such as postage. */
export interface DeliveryFee {
  itemId: number;
  quantity: number;
}

// Narrowly typed so the same helper serves every result shape that can be
// refused, not only QueueResult.
const fail = (
  reason: DeliveryFailure,
): { ok: false; reason: DeliveryFailure } => ({
  ok: false,
  reason,
});

function toRow(doc: PendingDelivery): PendingDelivery {
  return {
    id: doc.id,
    to: doc.to,
    itemId: doc.itemId,
    quantity: doc.quantity,
    source: doc.source,
    ...(doc.meta !== undefined && { meta: doc.meta }),
    createdAt: doc.createdAt,
  };
}

/**
 * Everything that has to be true before a row exists, and the row itself.
 *
 * The recipient is resolved against the database rather than the online
 * registry, because delivering to an offline player is the entire point; the
 * lookup also rejects a mistyped name, which would otherwise be a row nobody
 * can ever claim.
 */
async function prepareRow(
  input: DeliveryInput,
  session?: ClientSession,
): Promise<
  { ok: true; row: PendingDelivery } | { ok: false; reason: DeliveryFailure }
> {
  const quantity = Math.floor(Number(input.quantity ?? 1));
  if (!Number.isFinite(quantity) || quantity < 1) return fail('invalid-amount');

  const itemId = Number(input.itemId);
  if (!getItemById(itemId)) return fail('unknown-item');

  const online = getPlayerByName(String(input.to));
  const recipientName =
    online?.name ?? (await getPlayerByNameFromDb(String(input.to)))?.name;
  if (!recipientName) return fail('unknown-recipient');

  if (input.meta !== undefined && !measureValue(input.meta).ok) {
    return fail('meta-too-large');
  }

  const pending = await DeliveryModel.countDocuments({
    to: recipientName,
  }).session(session ?? null);
  if (pending >= MAX_PENDING_PER_PLAYER) return fail('mailbox-full');

  return {
    ok: true,
    row: {
      // Not from sim/rng: a row id is storage identity, not simulation state,
      // so it must not consume the seeded sequence that replay reproduces.
      id: crypto.randomUUID(),
      to: recipientName,
      itemId,
      quantity,
      source: String(input.source),
      ...(input.meta !== undefined && { meta: input.meta }),
      createdAt: Date.now(),
    },
  };
}

/** Queues an item for `to`, online or not, out of nowhere (a script grant). */
export function queueDelivery(
  input: DeliveryInput,
  session?: ClientSession,
): Promise<QueueResult> {
  return oneSendAtATime(String(input.to), async () => {
    const prepared = await prepareRow(input, session);
    if (!prepared.ok) return prepared;

    if (session) await DeliveryModel.create([prepared.row], { session });
    else await DeliveryModel.create(prepared.row);
    return { ok: true, id: prepared.row.id };
  });
}

/**
 * Takes the item out of the sender's inventory and queues it, as one commit.
 * The debit and the row are separate documents: row first prints an item,
 * debit first loses one. With transactions they commit together; without,
 * the debit goes first, since a GM can give an item back but cannot recall
 * a duplicate. On failure the sender's inventory is as it was, and the
 * caller must not refund, or the item comes back twice.
 */
export function sendDelivery(
  from: PlayerServer,
  input: DeliveryInput & { fee?: DeliveryFee },
): Promise<QueueResult> {
  return oneSendAtATime(String(input.to), () => sendHeld(from, input));
}

async function sendHeld(
  from: PlayerServer,
  input: DeliveryInput & { fee?: DeliveryFee },
): Promise<QueueResult> {
  const prepared = await prepareRow(input);
  if (!prepared.ok) return prepared;
  const { row } = prepared;
  // The queue and the lookups above yield. A logout in between saves `from`
  // and a login loads the account into another object; debiting this one would
  // take the item out of a document the new session then rewrites with it.
  if (getPlayerById(from.id) !== from || isPlayerCommitting(from.id))
    return fail('not-committed');
  beginPlayerCommit([from.id]);
  lockInventory(from.inventory);
  try {
    // A snapshot started before the hold must finish before the debit, or its
    // stale inventory can overwrite a transaction that has already committed.
    await waitForPlayerPersistence(from.id);
    const inventory = structuredClone(from.inventory);
    // The fee is taken in the same commit as the item: charged apart, a send
    // refused here would have to refund it, and a refund lands on whatever
    // holds the inventory by then.
    if (
      !removeItem(inventory, row.itemId, row.quantity).ok ||
      (input.fee &&
        !removeItem(inventory, input.fee.itemId, input.fee.quantity).ok)
    )
      return fail('not-enough');
    const debited = { ...from, inventory };
    if (supportsTransactions()) {
      const committed = await withTransaction(async (session) => {
        await persistPlayerSessionState(debited, session);
        await DeliveryModel.create([row], { session });
      }, `delivery send: ${from.name} -> ${row.to}`);
      if (!committed) return fail('not-committed');
    } else {
      try {
        await persistPlayerSessionState(debited);
      } catch (err) {
        logger.error('[delivery] sender debit not persisted; nothing queued', {
          player: from.name,
          err,
        });
        return fail('not-committed');
      }
      try {
        await DeliveryModel.create(row);
      } catch (err) {
        logger.error(
          '[delivery] row not created after debit; refunding sender',
          { player: from.name, err },
        );
        await persistPlayerSessionState(from).catch(() => undefined);
        return fail('not-committed');
      }
    }
    from.inventory.items = inventory.items;
    updatePlayer(from);
    return { ok: true, id: row.id };
  } finally {
    unlockInventory(from.inventory);
    endPlayerCommit([from.id]);
  }
}

/** Everything waiting for a player, oldest first. */
export async function listDeliveries(name: string): Promise<PendingDelivery[]> {
  const rows = await DeliveryModel.find({ to: String(name) })
    .sort({ createdAt: 1 })
    .lean<PendingDelivery[]>()
    .exec();
  return rows.map(toRow);
}

export async function countDeliveries(name: string): Promise<number> {
  return DeliveryModel.countDocuments({ to: String(name) });
}

/** Drops a queued row without delivering it (expiry, return to sender). */
export async function cancelDelivery(id: string): Promise<boolean> {
  const result = await DeliveryModel.deleteOne({ id: String(id) });
  return result.deletedCount > 0;
}

/**
 * Drops the rows owing an item the catalogue no longer has. Such a row is
 * stuck: `claimDeliveries` refuses it forever, and it holds a pending slot
 * until cancelled by an id nobody knows. Dropping it loses nothing the
 * deletion had not. Runs on item deletion and at boot, the only times a
 * row can turn unclaimable. An empty catalogue means content did not load,
 * so then it sweeps nothing rather than every mailbox in the game.
 */
export async function sweepUnclaimableDeliveries(): Promise<number> {
  const known = [...items.keys()];
  if (known.length === 0) return 0;

  const { deletedCount } = await DeliveryModel.deleteMany({
    itemId: { $nin: known },
  });
  if (deletedCount > 0) {
    logger.warn(
      '[delivery] dropped rows owing items no longer in the catalogue',
      {
        rows: deletedCount,
      },
    );
  }
  return deletedCount;
}

/**
 * The claimed ids whose rows still exist. An id is remembered exactly as
 * long as its row is queued, since that row is what a retry would hand
 * over again, so the record is pruned against the queue rather than cut to
 * a length one failed delete could outgrow.
 */
function readClaimedHistory(
  player: PlayerServer,
  pending: PendingDelivery[],
): string[] {
  const queued = new Set(pending.map((row) => row.id));
  return claimedDeliveryIds(player).filter((id) => queued.has(id));
}

/**
 * Deliveries already in `player`'s inventory. Their rows can still be queued,
 * after a delete that failed, and are not waiting for anyone.
 */
export function claimedDeliveryIds(
  player: Pick<PlayerServer, 'data'>,
): string[] {
  const stored = player.data?.[CLAIMED_KEY];
  if (!Array.isArray(stored)) return [];
  return stored.filter((v): v is string => typeof v === 'string');
}

/**
 * Moves pending items into an online player's inventory, at most once each.
 *
 * A full inventory is reported per row rather than aborting: the rest of the
 * queue may be stackable items that still fit, and the rows that did not fit
 * stay queued for the next attempt.
 */
export async function claimDeliveries(
  player: PlayerServer,
  ids?: string[],
): Promise<ClaimOutcome[]> {
  // One claim at a time per player, from the listing to the row delete: a
  // claim listing rows another is about to delete would find them unrecorded
  // and add them again. It waits rather than refuses, as two `/mail claim`
  // are a double-click; no await between the loop and the hold.
  while (isPlayerCommitting(player.id)) await waitForPlayerCommit(player.id);
  beginPlayerCommit([player.id]);
  try {
    // A snapshot cast before the claim must land first, or it erases the item
    // after its row is gone.
    await waitForPlayerPersistence(player.id);
    return await claimHeld(player, ids);
  } finally {
    endPlayerCommit([player.id]);
  }
}

async function claimHeld(
  player: PlayerServer,
  ids?: string[],
): Promise<ClaimOutcome[]> {
  const pending = await listDeliveries(player.name);
  const wanted = ids ? pending.filter((row) => ids.includes(row.id)) : pending;
  if (wanted.length === 0) return [];

  const claimed = readClaimedHistory(player, pending);
  const outcomes: ClaimOutcome[] = [];
  const settled: string[] = [];

  for (const row of wanted) {
    if (claimed.includes(row.id)) {
      // Already in the inventory and saved; only the row deletion failed last
      // time. Adding it again is the duplicate this record exists to prevent.
      settled.push(row.id);
      outcomes.push({ id: row.id, ok: true });
      continue;
    }

    // An item deleted from the catalogue after the row was queued would put an
    // entry in the inventory that the stats payload leaves out, taking a slot
    // the player can neither see nor empty.
    if (!getItemById(row.itemId)) {
      outcomes.push({ id: row.id, ok: false, reason: 'unknown-item' });
      continue;
    }

    if (!addItem(player.inventory, row.itemId, row.quantity).ok) {
      outcomes.push({ id: row.id, ok: false, reason: 'no-space' });
      continue;
    }

    claimed.push(row.id);
    settled.push(row.id);
    outcomes.push({ id: row.id, ok: true });
  }

  if (settled.length === 0) return outcomes;

  (player.data ??= {})[CLAIMED_KEY] = claimed;

  try {
    // One write, carrying both the inventory and the claim record. Deleting the
    // rows before this returns would risk losing the items with it.
    await persistPlayerSessionState(player);
  } catch (err) {
    logger.error('[delivery] claim not persisted; rows kept for a retry', {
      player: player.name,
      err,
    });
    return outcomes;
  }

  try {
    await DeliveryModel.deleteMany({ id: { $in: settled } });
  } catch (err) {
    // The items are already saved, so the claim happened; the rows left behind
    // are skipped by the record above and cleared by the next claim.
    logger.error('[delivery] claimed rows not deleted', {
      player: player.name,
      err,
    });
  }
  return outcomes;
}
