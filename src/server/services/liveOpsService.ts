// Live-ops flags: gameplay switches an operator changes while the server
// runs. This file owns reading them; the effect on the game arrives
// through a hook. `gameConfig` is what a creator tunes before boot, and a
// double-XP weekend cannot wait for a restart.
//
// Reads are synchronous against an in-memory map, since the callers are
// hooks inside the tick. They are also pure: starting a scheduled flag,
// retiring an expired one and telling scripts about it all happen in the
// sweep, so the hot path stays a lookup and two comparisons.

import mongoose from 'mongoose';
import LiveOpsFlagModel from '../model/LiveOpsFlag.js';
import { emit, on } from '../engine/hooks.js';
import { scheduleEvery } from '../sim/scheduler.js';
import { publishToInstances } from '../persistence/instanceBus.js';
import { msToTicks } from '../sim/clock.js';
import { logger } from '../logger.js';

/** Scalars only: a flag comes in as a command argument and is stored. */
export type FlagValue = boolean | number | string;

export interface LiveOpsFlag {
  name: string;
  value: FlagValue;
  /** Epoch ms. Absent means it applies from the moment it was set. */
  startsAt?: number;
  /** Epoch ms. Absent means it applies until someone clears it. */
  expiresAt?: number;
  setBy?: string;
  setAt: number;
  note?: string;
}

/**
 * The one flag the engine acts on by itself, applied in `beforeXpGain` below.
 * Everything else is read by scripts and modules, which decide what it means.
 */
export const XP_MULTIPLIER_FLAG = 'xpMultiplier';

/**
 * How often the sweep looks for a flag that started or ended.
 *
 * A second of slack on an event measured in hours is invisible, and it keeps
 * the walk off the 20 Hz hot path. Reads do not depend on it: a flag applies
 * the moment its clock says so, sweep or no sweep.
 */
const SWEEP_INTERVAL_MS = 1_000;

const flags = new Map<string, LiveOpsFlag>();

/**
 * Names whose `liveOpsFlag` start was already announced. The hook fires on
 * the edge, once per transition and not per boot, so a restart mid-event
 * does not re-run what the script does at the start. A script needing the
 * current state at load reads `flags.enabled`.
 */
const announced = new Set<string>();

/**
 * Without a connection mongoose buffers a write for ten seconds before
 * rejecting it. An operator flipping a flag during a database outage would
 * watch the console hang instead of getting the answer that matters: the flag
 * is on, and it will not survive a restart.
 */
function databaseReachable(): boolean {
  return mongoose.connection.readyState === mongoose.ConnectionStates.connected;
}

function pending(flag: LiveOpsFlag, now: number): boolean {
  return flag.startsAt !== undefined && flag.startsAt > now;
}

function expired(flag: LiveOpsFlag, now: number): boolean {
  return flag.expiresAt !== undefined && flag.expiresAt <= now;
}

/** Whether the flag applies right now. Pure; the sweep owns transitions. */
function applies(flag: LiveOpsFlag, now = Date.now()): boolean {
  return !pending(flag, now) && !expired(flag, now);
}

export function getFlag(name: string): LiveOpsFlag | undefined {
  const flag = flags.get(name);
  return flag && applies(flag) ? flag : undefined;
}

/** True only for the boolean `true`; a flag set to 0 or "" is not on. */
export function flagEnabled(name: string): boolean {
  return getFlag(name)?.value === true;
}

/**
 * A numeric flag, or `fallback` when it is absent, expired or not a usable
 * number. Callers are multiplying damage and experience by this, so a NaN
 * reaching them would erase a player's progress rather than fail loudly.
 */
export function flagNumber(name: string, fallback: number): number {
  const value = getFlag(name)?.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * What an operator should see: everything that is on plus everything that is
 * scheduled, newest change first. Expired flags are gone from this list before
 * the sweep gets round to deleting the row.
 */
export function listFlags(): LiveOpsFlag[] {
  const now = Date.now();
  return [...flags.values()]
    .filter((flag) => !expired(flag, now))
    .sort((a, b) => b.setAt - a.setAt);
}

/**
 * Tells scripts a flag started or ended, exactly once per transition.
 *
 * This is the half of live-ops a passive read cannot give: "spawn the boss when
 * the event starts" needs the edge, not the value.
 */
function announce(flag: LiveOpsFlag, active: boolean): void {
  if (active) announced.add(flag.name);
  else announced.delete(flag.name);
  logger.info(active ? '[liveops] flag started' : '[liveops] flag ended', {
    name: flag.name,
    value: flag.value,
  });
  emit('liveOpsFlag', { name: flag.name, value: flag.value, active });
}

function deleteRow(name: string): void {
  if (!databaseReachable()) return;
  void LiveOpsFlagModel.deleteOne({ name }).catch((err) =>
    logger.error('[liveops] could not delete a flag row', { name, err }),
  );
}

/**
 * Tick system (every `SWEEP_INTERVAL_MS`): starts what is due, retires what is
 * over, and tells scripts about both.
 *
 * The single place that mutates flag state on the clock, so an expired flag is
 * deleted once rather than once per reader, and the edge cannot be missed by a
 * read that happened to get there first.
 */
export function sweepLiveOpsFlags(): void {
  const now = Date.now();
  for (const flag of [...flags.values()]) {
    const active = applies(flag, now);
    if (active !== announced.has(flag.name)) announce(flag, active);
    if (expired(flag, now)) {
      flags.delete(flag.name);
      deleteRow(flag.name);
    }
  }
}

export async function setFlag(
  name: string,
  value: FlagValue,
  options: {
    startsAt?: number;
    expiresAt?: number;
    setBy?: string;
    note?: string;
  } = {},
): Promise<LiveOpsFlag> {
  const flag: LiveOpsFlag = {
    name,
    value,
    setAt: Date.now(),
    ...(options.startsAt !== undefined ? { startsAt: options.startsAt } : {}),
    ...(options.expiresAt !== undefined
      ? { expiresAt: options.expiresAt }
      : {}),
    ...(options.setBy !== undefined ? { setBy: options.setBy } : {}),
    ...(options.note !== undefined ? { note: options.note } : {}),
  };

  // Memory first, then the database: the operator asked for this to apply
  // at once, and a failed write should not also mean it never applied. The
  // log says the change will not survive a restart.
  flags.set(name, flag);
  try {
    if (!databaseReachable()) throw new Error('no database connection');
    await LiveOpsFlagModel.findOneAndUpdate(
      { name },
      {
        name,
        value,
        startsAt: flag.startsAt ? new Date(flag.startsAt) : undefined,
        expiresAt: flag.expiresAt ? new Date(flag.expiresAt) : undefined,
        setBy: flag.setBy,
        setAt: new Date(flag.setAt),
        note: flag.note,
      },
      { upsert: true },
    );
  } catch (err) {
    logger.error('[liveops] flag set in memory but not persisted', {
      name,
      err,
    });
  }
  logger.info('[liveops] flag set', {
    name,
    value,
    startsAt: flag.startsAt,
    expiresAt: flag.expiresAt,
    setBy: flag.setBy,
  });

  // A flag that applies at once announces itself here rather than
  // waiting up to a second for the sweep, so the event is running by the
  // time the command answers.
  const active = applies(flag);
  if (active !== announced.has(name)) announce(flag, active);
  publishToInstances('flagSet', flag);
  return flag;
}

/**
 * A flag an operator set on another instance, taking effect here. The row
 * is already written; this side lacks the cache every read goes through
 * and the edge its own scripts wait on.
 */
export function applyFlagFromInstance(flag: LiveOpsFlag): void {
  flags.set(flag.name, flag);
  const active = applies(flag);
  if (active !== announced.has(flag.name)) announce(flag, active);
}

export function forgetFlagFromInstance(name: string): void {
  const flag = flags.get(name);
  flags.delete(name);
  if (flag && announced.has(name)) announce(flag, false);
}

/** Returns false when there was nothing to clear. */
export async function clearFlag(name: string): Promise<boolean> {
  const flag = flags.get(name);
  flags.delete(name);
  try {
    if (!databaseReachable()) throw new Error('no database connection');
    await LiveOpsFlagModel.deleteOne({ name });
  } catch (err) {
    logger.error('[liveops] flag cleared in memory but not in the database', {
      name,
      err,
    });
  }
  if (!flag) return false;
  logger.info('[liveops] flag cleared', { name });
  publishToInstances('flagCleared', { name });
  // Only a flag that was running has an end to announce; one cancelled before
  // its start time never happened as far as a script is concerned.
  if (announced.has(name)) announce(flag, false);
  return true;
}

/**
 * Reads every flag into memory at boot.
 *
 * A flag whose time passed while the server was down is dropped here rather
 * than loaded and expired on first read, so `flag` lists what is actually on.
 * One scheduled for later is kept: that is the point of persisting the start
 * time instead of holding a timer.
 */
export async function loadLiveOpsFlags(): Promise<void> {
  const rows = await LiveOpsFlagModel.find().lean().exec();
  flags.clear();
  announced.clear();
  const gone: string[] = [];

  for (const row of rows) {
    const value = row.value as FlagValue;
    if (
      typeof value !== 'boolean' &&
      typeof value !== 'number' &&
      typeof value !== 'string'
    ) {
      logger.warn('[liveops] ignoring a flag whose value is not a scalar', {
        name: row.name,
      });
      continue;
    }

    const expiresAt = row.expiresAt ? row.expiresAt.getTime() : undefined;
    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      gone.push(row.name);
      continue;
    }

    const flag: LiveOpsFlag = {
      name: row.name,
      value,
      ...(row.startsAt ? { startsAt: row.startsAt.getTime() } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      ...(row.setBy ? { setBy: row.setBy } : {}),
      setAt: row.setAt ? row.setAt.getTime() : Date.now(),
      ...(row.note ? { note: row.note } : {}),
    };
    flags.set(row.name, flag);
    // Already running before the restart counts as already announced: the
    // event did not start again just because the process did.
    if (applies(flag)) announced.add(flag.name);
  }

  if (gone.length) {
    await LiveOpsFlagModel.deleteMany({ name: { $in: gone } });
  }
  logger.info('[liveops] flags loaded', {
    active: announced.size,
    scheduled: flags.size - announced.size,
    droppedAsExpired: gone.length,
  });
}

/**
 * Wires the two things live-ops needs from the running server: the engine's own
 * use of a flag, and the clock that starts and ends the scheduled ones.
 *
 * The multiplier goes through the hook rather than into `awardExperience`
 * directly so it composes with the modules already scaling the same number
 * (guild, party) instead of racing them, and so a game that wants different
 * behaviour can ignore the flag entirely.
 */
export function startLiveOps(): void {
  on('beforeXpGain', (ctx) => {
    const multiplier = flagNumber(XP_MULTIPLIER_FLAG, 1);
    if (multiplier !== 1) ctx.amount *= multiplier;
  });

  // Tick-driven, not setInterval: gameplay that fires off the simulation's beat
  // is invisible to the replay recorder (see sim/scheduler.ts).
  scheduleEvery(msToTicks(SWEEP_INTERVAL_MS), sweepLiveOpsFlags, 'liveops');
}

/** Test seam: the cache is module state, like every other cache here. */
export function clearLiveOpsFlagsForTest(): void {
  flags.clear();
  announced.clear();
}
