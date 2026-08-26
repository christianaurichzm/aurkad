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

import crypto from 'crypto';
import DeliveryModel from '../../model/Delivery.js';
import { addItem, removeItem } from './economyService.js';
import {
  supportsTransactions,
  withTransaction,
} from '../../persistence/transactions.js';
import { getItemById } from './inventoryService.js';
import { items } from '../world/gameData.js';
import { getPlayerByName } from '../../sim/world.js';
import {
  getPlayerByNameFromDb,
  persistPlayerSessionState,
} from '../player/playerService.js';
import { measureValue } from '../../persistence/dataLimits.js';
import { logger } from '../../logger.js';
import type { PlayerServer } from '../../../shared/types.js';

/**
 * Pending rows one recipient may hold. The cap is the recipient's, so one
 * player cannot fill another's queue and the rows per player stay bounded
 * however long they stay away.
 */
const MAX_PENDING_PER_PLAYER = 100;

/**
 * How many claimed ids are remembered on the player document.
 *
 * Only needed to cover the window between "player saved" and "row deleted",
 * which is one round trip, so this is generous. An id drops off the ring only
 * after that many later claims, by which point its row is long gone.
 */
const CLAIMED_HISTORY = 50;

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

  const pending = await DeliveryModel.countDocuments({ to: recipientName });
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
export async function queueDelivery(
  input: DeliveryInput,
): Promise<QueueResult> {
  const prepared = await prepareRow(input);
  if (!prepared.ok) return prepared;

  await DeliveryModel.create(prepared.row);
  return { ok: true, id: prepared.row.id };
}

/**
 * Takes the item out of the sender's inventory and queues it, as one commit.
 * The debit and the row are separate documents: row first prints an item,
 * debit first loses one. With transactions they commit together; without,
 * the debit goes first, since a GM can give an item back but cannot recall
 * a duplicate. On failure the sender's inventory is as it was, and the
 * caller must not refund, or the item comes back twice.
 */
export async function sendDelivery(
  from: PlayerServer,
  input: DeliveryInput,
): Promise<QueueResult> {
  const prepared = await prepareRow(input);
  if (!prepared.ok) return prepared;
  const { row } = prepared;

  // Synchronous with the check inside it, and only now: everything above this
  // line awaited, and an inventory can change across an await.
  if (!removeItem(from.inventory, row.itemId, row.quantity).ok) {
    return fail('not-enough');
  }

  const restore = () => {
    // Always fits: the slot it came from was freed a moment ago.
    addItem(from.inventory, row.itemId, row.quantity);
  };

  if (supportsTransactions()) {
    const committed = await withTransaction(async (session) => {
      await persistPlayerSessionState(from, session);
      await DeliveryModel.create([row], { session });
    }, `delivery send: ${from.name} -> ${row.to}`);
    if (!committed) {
      restore();
      return fail('not-committed');
    }
    return { ok: true, id: row.id };
  }

  try {
    await persistPlayerSessionState(from);
  } catch (err) {
    logger.error('[delivery] sender debit not persisted; nothing queued', {
      player: from.name,
      err,
    });
    restore();
    return fail('not-committed');
  }

  try {
    await DeliveryModel.create(row);
  } catch (err) {
    // The window this ADR-0024 note is about: the debit is already durable, so
    // the item is gone until the refund below is itself persisted.
    logger.error('[delivery] row not created after debit; refunding sender', {
      player: from.name,
      err,
    });
    restore();
    await persistPlayerSessionState(from).catch(() => undefined);
    return fail('not-committed');
  }

  return { ok: true, id: row.id };
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

function readClaimedHistory(player: PlayerServer): string[] {
  const stored = player.data?.[CLAIMED_KEY];
  return Array.isArray(stored)
    ? stored.filter((v) => typeof v === 'string')
    : [];
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
  const pending = await listDeliveries(player.name);
  const wanted = ids ? pending.filter((row) => ids.includes(row.id)) : pending;
  if (wanted.length === 0) return [];

  const claimed = readClaimedHistory(player);
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
    // unresolvable entry in the inventory, which then throws while building the
    // player's stats payload.
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

  (player.data ??= {})[CLAIMED_KEY] = claimed.slice(-CLAIMED_HISTORY);

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

  await DeliveryModel.deleteMany({ id: { $in: settled } });
  return outcomes;
}
