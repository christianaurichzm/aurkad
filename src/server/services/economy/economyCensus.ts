// Counting every item that exists, so duplication has somewhere to show up.
// economyService conserves items per operation, but a bug outside it, a
// script minting gold in a loop or a crash mid-transfer changes the totals
// with no operation looking wrong. So this totals every place an item can
// be, and the list of places is the feature: a store left out is a hiding
// spot, like the delivery queue holding items outside any player document.
//
// A census, not a ledger: a ledger says why a total moved but needs every
// path that mints or burns to report itself, and new code can forget. An
// item in a container nobody declared still shows where it lives.

import mongoose from 'mongoose';
import DeliveryModel from '../../model/Delivery.js';
import EconomyCensusModel from '../../model/EconomyCensus.js';
import { runtimeState } from '../../sim/state.js';
import { playerRepository } from '../../persistence/playerRepository.js';
import { scheduleEvery, cancelScheduled } from '../../sim/scheduler.js';
import { msToTicks } from '../../sim/clock.js';
import { config } from '../../config.js';
import { logger } from '../../logger.js';
import type { InventoryLike, PlayerServer } from '../../../shared/types.js';

/** Where a total came from, so a spike points somewhere. */
export type ItemLocation =
  'inventory' | 'equipped' | 'playerData' | 'delivery' | 'ground';

export interface ItemTally {
  itemId: number;
  total: number;
  /** Totals split by where the items are sitting. */
  byLocation: Record<ItemLocation, number>;
  /** Biggest holders, for the "who" question that follows a spike. */
  topHolders: Array<{ name: string; quantity: number }>;
}

export interface EconomyCensus {
  at: number;
  /** Player documents counted, so a partial census is recognisable as one. */
  players: number;
  items: ItemTally[];
}

/** Holders kept per item: enough to investigate, not a copy of the database. */
const TOP_HOLDERS = 5;

function emptyByLocation(): Record<ItemLocation, number> {
  return {
    inventory: 0,
    equipped: 0,
    playerData: 0,
    delivery: 0,
    ground: 0,
  };
}

/**
 * Containers a module parked in a player's data bag.
 *
 * The bank is one, and the shape is the same for any other a game invents, so
 * this looks for the shape instead of a list of known keys: a bank counted and
 * a guild vault missed would be a census that quietly excuses duplication in
 * whichever store nobody remembered.
 */
function containersInData(data: Record<string, unknown> | undefined) {
  const found: InventoryLike[] = [];
  for (const value of Object.values(data ?? {})) {
    if (!value || typeof value !== 'object') continue;
    const candidate = value as Partial<InventoryLike>;
    if (Array.isArray(candidate.items)) found.push(candidate as InventoryLike);
  }
  return found;
}

class Tally {
  private readonly totals = new Map<number, ItemTally>();

  add(itemId: number, quantity: number, where: ItemLocation, holder?: string) {
    if (!Number.isFinite(itemId) || quantity <= 0) return;
    let entry = this.totals.get(itemId);
    if (!entry) {
      entry = {
        itemId,
        total: 0,
        byLocation: emptyByLocation(),
        topHolders: [],
      };
      this.totals.set(itemId, entry);
    }
    entry.total += quantity;
    entry.byLocation[where] += quantity;
    if (holder) {
      const existing = entry.topHolders.find((h) => h.name === holder);
      if (existing) existing.quantity += quantity;
      else entry.topHolders.push({ name: holder, quantity });
    }
  }

  finish(): ItemTally[] {
    return [...this.totals.values()]
      .map((entry) => ({
        ...entry,
        topHolders: entry.topHolders
          .sort((a, b) => b.quantity - a.quantity)
          .slice(0, TOP_HOLDERS),
      }))
      .sort((a, b) => b.total - a.total);
  }
}

function countPlayer(
  tally: Tally,
  player: Pick<PlayerServer, 'name' | 'inventory' | 'equipped' | 'data'>,
): void {
  for (const slot of player.inventory?.items ?? []) {
    tally.add(Number(slot.item), slot.quantity, 'inventory', player.name);
  }
  // Equipment is off the inventory but is still an item that exists; a census
  // that skipped it would read a player swapping gear as items appearing.
  for (const itemId of Object.values(player.equipped ?? {})) {
    if (typeof itemId === 'number') {
      tally.add(itemId, 1, 'equipped', player.name);
    }
  }
  for (const container of containersInData(player.data)) {
    for (const slot of container.items) {
      tally.add(Number(slot.item), slot.quantity, 'playerData', player.name);
    }
  }
}

/**
 * Counts every item in the world, online or not.
 *
 * Reads player documents from the database rather than the online registry:
 * most items belong to players who are logged out, and a census of only the
 * connected ones would call a normal evening a mass disappearance. Online
 * players are counted from memory instead, because their document is up to
 * `PLAYER_SNAPSHOT_INTERVAL_MS` behind what they are actually holding.
 */
export async function takeCensus(): Promise<EconomyCensus> {
  const tally = new Tally();

  const online = new Map<string, PlayerServer>();
  for (const map of Object.values(runtimeState.maps)) {
    for (const player of Object.values(map.players)) {
      online.set(player.name, player);
    }
    for (const drop of map.droppedItems) {
      tally.add(Number(drop.itemId), drop.quantity, 'ground');
    }
  }

  const stored = await playerRepository.list();
  for (const record of stored) {
    countPlayer(tally, online.get(record.name) ?? record);
    online.delete(record.name);
  }
  // A session whose document has not been written yet still holds items.
  for (const player of online.values()) countPlayer(tally, player);

  const pending = await DeliveryModel.find()
    .select('itemId quantity to -_id')
    .lean<Array<{ itemId: number; quantity: number; to: string }>>()
    .exec();
  for (const row of pending) {
    tally.add(Number(row.itemId), row.quantity, 'delivery', row.to);
  }

  return {
    at: Date.now(),
    players: stored.length,
    items: tally.finish(),
  };
}

export interface CensusDelta {
  itemId: number;
  before: number;
  after: number;
  change: number;
  /** Who holds it now, so an investigation starts somewhere. */
  topHolders: Array<{ name: string; quantity: number }>;
}

/**
 * What changed between two censuses, biggest move first. Loot mints and
 * consumables burn, so change is normal; the shape is the signal (a total
 * doubling in an hour, a bound item growing at all), so this reports
 * rather than judges.
 */
export function compareCensus(
  before: EconomyCensus,
  after: EconomyCensus,
): CensusDelta[] {
  const previous = new Map(before.items.map((i) => [i.itemId, i.total]));
  const deltas: CensusDelta[] = [];

  for (const entry of after.items) {
    const was = previous.get(entry.itemId) ?? 0;
    // Taken off the map either way: what stays behind is what the new census
    // has no entry for at all, and an unchanged total is not that.
    previous.delete(entry.itemId);
    if (was === entry.total) continue;
    deltas.push({
      itemId: entry.itemId,
      before: was,
      after: entry.total,
      change: entry.total - was,
      topHolders: entry.topHolders,
    });
  }

  // An item that vanished entirely is as interesting as one that appeared.
  for (const [itemId, was] of previous) {
    if (was === 0) continue;
    deltas.push({
      itemId,
      before: was,
      after: 0,
      change: -was,
      topHolders: [],
    });
  }

  return deltas.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
}

// ---- the periodic job ----
//
// Scheduled off the tick rather than a setInterval, like everything else with
// a cadence in this engine, so it cannot run while the simulation is mid-frame
// and a paused loop pauses it too.

/** Persists one census and returns it with the change since the last one. */
export async function runCensus(): Promise<{
  census: EconomyCensus;
  deltas: CensusDelta[];
}> {
  const census = await takeCensus();
  const previous = await latestCensus();

  await EconomyCensusModel.create({ ...census, at: new Date(census.at) });

  const deltas = previous ? compareCensus(previous, census) : [];
  report(deltas);
  return { census, deltas };
}

/** The most recent stored census, or null on the very first run. */
export async function latestCensus(): Promise<EconomyCensus | null> {
  const row = await EconomyCensusModel.findOne()
    .sort({ at: -1 })
    .select('-_id -__v')
    .lean<(EconomyCensus & { at: Date }) | null>()
    .exec();
  return row ? { ...row, at: new Date(row.at).getTime() } : null;
}

/**
 * Whether a change is worth an operator's attention.
 *
 * Two conditions together, because either alone is noise: a percentage catches
 * the shape of duplication (a total that doubles) while the floor keeps a
 * handful of new potions from tripping it on a quiet server.
 */
export function isSuspicious(delta: CensusDelta): boolean {
  if (delta.change < config.economy.censusAlertFloor) return false;
  if (delta.before === 0) return true;
  return delta.change / delta.before >= config.economy.censusAlertGrowth / 100;
}

function report(deltas: CensusDelta[]): void {
  const suspicious = deltas.filter(isSuspicious);
  for (const delta of suspicious) {
    logger.warn('[economy] item total grew faster than expected', {
      itemId: delta.itemId,
      before: delta.before,
      after: delta.after,
      change: delta.change,
      // The holders are the point: an alert without a name to check is a
      // notification, not a lead.
      topHolders: delta.topHolders,
    });
  }
  if (deltas.length > 0 && suspicious.length === 0) {
    logger.info('[economy] census taken', { changed: deltas.length });
  }
}

let scheduled: number | null = null;

/** Starts the periodic count. Returns a stop function for shutdown. */
export function startCensusJob(): () => void {
  const everyTicks = msToTicks(config.economy.censusIntervalMinutes * 60_000);
  scheduled = scheduleEvery(
    everyTicks,
    () => {
      // Skipped rather than queued when the database is away: a census with
      // half the players missing would read as a mass disappearance and cry
      // wolf at exactly the wrong moment.
      if (
        mongoose.connection.readyState !== mongoose.ConnectionStates.connected
      )
        return;
      void runCensus().catch((err) =>
        logger.error('[economy] census failed', { err }),
      );
    },
    'economy-census',
  );

  return () => {
    if (scheduled !== null) cancelScheduled(scheduled);
    scheduled = null;
  };
}
