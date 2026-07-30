// Periodic reconciliation: count the world, compare with the last count, and
// say something when a total moved in a way loot and spending do not explain.
//
// Scheduled off the tick rather than a setInterval, like everything else with a
// cadence in this engine, so it cannot run while the simulation is mid-frame
// and so a paused loop pauses it too.

import mongoose from 'mongoose';
import EconomyCensusModel from '../../model/EconomyCensus.js';
import {
  compareCensus,
  takeCensus,
  type CensusDelta,
  type EconomyCensus,
} from './economyCensus.js';
import { scheduleEvery, cancelScheduled } from '../../sim/scheduler.js';
import { msToTicks } from '../../sim/clock.js';
import { config } from '../../config.js';
import { logger } from '../../logger.js';

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
      if (mongoose.connection.readyState !== 1) return;
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
