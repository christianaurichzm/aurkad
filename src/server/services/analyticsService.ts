import crypto from 'node:crypto';
import mongoose from 'mongoose';
import PlayerDayModel from '../model/PlayerDay.js';
import PlayerModel from '../model/Player.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { on } from '../engine/hooks.js';

/**
 * Who plays, how often, and whether they come back. `/metrics` covers the
 * process and the economy census the world; this answers "are people still
 * here" and "did the newcomers stay" after a patch.
 *
 * It hangs off `playerJoin` and `playerLeave`, so the auth path reports
 * nothing itself, and the admin panel login, which registers no player, is
 * not counted. It reads and writes `PlayerDay` rows only, with no rollup or
 * cache: the reports are a few counts a day over an indexed range.
 */

/** When each live session started, so its length is known when it ends. */
const openedAt = new Map<string, number>();

/**
 * Writes in flight. The record calls are fire-and-forget, as a login must
 * not wait on measuring itself, so a shutdown or a test waits on these.
 * Entries remove themselves; a failed write logs and leaves nothing.
 */
const inFlight = new Set<Promise<unknown>>();

function track(write: Promise<unknown>, what: string, player: string): void {
  const tracked = write
    .catch((err) =>
      logger.error(`[analytics] could not record ${what}`, { player, err }),
    )
    .finally(() => inFlight.delete(tracked));
  inFlight.add(tracked);
}

/** Waits for the writes already started. Used by the shutdown and the tests. */
export async function flushAnalytics(): Promise<void> {
  await Promise.allSettled([...inFlight]);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight UTC of the day a moment falls in. */
export const startOfDay = (at: number | Date): Date =>
  new Date(Math.floor(new Date(at).getTime() / DAY_MS) * DAY_MS);

/** `YYYY-MM-DD`, which is how a day is read back to a person. */
export const dayLabel = (day: Date): string => day.toISOString().slice(0, 10);

const connected = () =>
  mongoose.connection.readyState === mongoose.ConnectionStates.connected;

/**
 * The day an account was registered, from the document's own `_id`, which
 * carries the moment it was inserted: every account has one without a field
 * or a migration, while a `createdAt` written from now on would leave
 * existing players without a cohort.
 */
async function cohortOf(name: string): Promise<Date> {
  const doc = await PlayerModel.findOne({ name }, { _id: 1 }).lean().exec();
  return startOfDay(doc?._id.getTimestamp() ?? new Date());
}

async function writeLogin(name: string, at: number): Promise<void> {
  const day = startOfDay(at);
  await PlayerDayModel.updateOne(
    { day, player: name },
    { $inc: { sessions: 1 }, $setOnInsert: { cohort: await cohortOf(name) } },
    { upsert: true },
  ).exec();
}

/**
 * A session started. Never awaited and never throws: the login already
 * happened, and losing a data point beats failing the request behind it.
 */
export function recordLogin(name: string, at: number = Date.now()): void {
  if (!config.analytics.enabled) return;
  openedAt.set(name, at);
  if (!connected()) return;

  track(writeLogin(name, at), 'a login', name);
}

/**
 * A session ended, so its length is known. A session the process did not
 * see end (a crash, a kill -9) counts as a login with no time, rather than
 * a write per player per minute to make the last minutes exact.
 */
export function recordLogout(name: string, at: number = Date.now()): void {
  const started = openedAt.get(name);
  openedAt.delete(name);
  if (!config.analytics.enabled || started === undefined || !connected()) {
    return;
  }

  const minutes = Math.max(0, (at - started) / 60_000);
  track(
    // The day the session STARTED, which is why the moment is kept rather than
    // recomputed here: one session that crossed midnight is one session.
    //
    // Chained onto the login's own write when there is one still in flight:
    // the row it increments is the row that write creates, and an $inc that
    // arrives first would find nothing to add to.
    flushAnalytics().then(() =>
      PlayerDayModel.updateOne(
        { day: startOfDay(started), player: name },
        { $inc: { minutes } },
      ).exec(),
    ),
    'a session length',
    name,
  );
}

/** Subscribes to the two edges; returns the stop, for tests and shutdown. */
export function startAnalytics(): () => void {
  if (!config.analytics.enabled) {
    logger.info('[analytics] disabled; no player activity is recorded');
    return () => {};
  }

  const offJoin = on('playerJoin', ({ player }) => recordLogin(player.name));
  const offLeave = on('playerLeave', ({ player }) => recordLogout(player.name));

  return () => {
    offJoin();
    offLeave();
    openedAt.clear();
  };
}

export interface DayActivity {
  day: string;
  /** Distinct players, which is what one row per player-day makes it. */
  players: number;
  /** Of those, the ones who registered that same day. */
  newPlayers: number;
  sessions: number;
  minutes: number;
}

/** Active players per day, newest last, for the last `days` days. */
export async function dailyActivity(days: number): Promise<DayActivity[]> {
  const from = startOfDay(Date.now() - (days - 1) * DAY_MS);

  const rows = await PlayerDayModel.aggregate<{
    _id: Date;
    players: number;
    newPlayers: number;
    sessions: number;
    minutes: number;
  }>([
    { $match: { day: { $gte: from } } },
    {
      $group: {
        _id: '$day',
        players: { $sum: 1 },
        newPlayers: {
          $sum: { $cond: [{ $eq: ['$cohort', '$day'] }, 1, 0] },
        },
        sessions: { $sum: '$sessions' },
        minutes: { $sum: '$minutes' },
      },
    },
    { $sort: { _id: 1 } },
  ]).exec();

  return rows.map((row) => ({
    day: dayLabel(row._id),
    players: row.players,
    newPlayers: row.newPlayers,
    sessions: row.sessions,
    minutes: Math.round(row.minutes),
  }));
}

export interface CohortRetention {
  cohort: string;
  /** Everyone whose account was made that day and who played at least once. */
  players: number;
  /** How many of them played again N days later, keyed by N. */
  returned: Record<number, number>;
}

/**
 * Retention by arrival day.
 *
 * One aggregation rather than a count per cohort per mark: the same numbers
 * either way, and the loop version is fifty round trips for a fortnight of
 * cohorts. The day offsets are computed by subtracting two midnights, which is
 * exact because both are UTC and no operator's clock change can move them.
 */
export async function retention(
  cohorts: number,
  marks: number[] = [1, 7, 30],
): Promise<CohortRetention[]> {
  const from = startOfDay(Date.now() - (cohorts - 1) * DAY_MS);
  const counters: Record<string, unknown> = {};
  for (const mark of marks) {
    counters[`d${mark}`] = {
      $sum: { $cond: [{ $in: [mark, '$offsets'] }, 1, 0] },
    };
  }

  const rows = await PlayerDayModel.aggregate<
    { _id: Date; players: number } & Record<string, number>
  >([
    { $match: { cohort: { $gte: from } } },
    {
      // Per player first: a person is retained on day N or not, however many
      // times they logged in that day.
      $group: {
        _id: { cohort: '$cohort', player: '$player' },
        offsets: {
          $addToSet: {
            $divide: [{ $subtract: ['$day', '$cohort'] }, DAY_MS],
          },
        },
      },
    },
    {
      $group: { _id: '$_id.cohort', players: { $sum: 1 }, ...counters },
    },
    { $sort: { _id: 1 } },
  ]).exec();

  return rows.map((row) => ({
    cohort: dayLabel(row._id),
    players: row.players,
    returned: Object.fromEntries(
      marks.map((mark) => [mark, row[`d${mark}`] ?? 0]),
    ),
  }));
}

export interface Funnel {
  from: string;
  to: string;
  /** Accounts created in the window, whether or not they ever played. */
  registered: number;
  /** Of those, the ones who logged in at least once. */
  played: number;
  /** Of those, the ones who came back on a second day. */
  returned: number;
  level: number;
  /** Of those registered, how many ever reached that level. */
  reachedLevel: number;
}

/**
 * Registered, played, came back, got somewhere. The first and last steps
 * count player documents by the timestamp in `_id`, so "registered but
 * never played" is a real number. The level step is lifetime, not windowed:
 * the question is whether the game gets anyone that far, not how fast.
 */
export async function funnel(days: number, level: number): Promise<Funnel> {
  const from = startOfDay(Date.now() - (days - 1) * DAY_MS);
  const to = new Date(startOfDay(Date.now()).getTime() + DAY_MS);
  const range = {
    $gte: mongoose.Types.ObjectId.createFromTime(from.getTime() / 1000),
    $lt: mongoose.Types.ObjectId.createFromTime(to.getTime() / 1000),
  };

  const [registered, reachedLevel, byPlayer] = await Promise.all([
    PlayerModel.countDocuments({ _id: range }).exec(),
    PlayerModel.countDocuments({ _id: range, level: { $gte: level } }).exec(),
    PlayerDayModel.aggregate<{ _id: string; days: number }>([
      { $match: { cohort: { $gte: from, $lt: to } } },
      { $group: { _id: '$player', days: { $sum: 1 } } },
    ]).exec(),
  ]);

  return {
    from: dayLabel(from),
    to: dayLabel(startOfDay(Date.now())),
    registered,
    played: byPlayer.length,
    returned: byPlayer.filter((row) => row.days >= 2).length,
    level,
    reachedLevel,
  };
}

/** One player's own rows, for the account export. */
export async function activityOf(
  name: string,
): Promise<Array<{ day: string; sessions: number; minutes: number }>> {
  const rows = await PlayerDayModel.find({ player: name })
    .sort({ day: 1 })
    .lean()
    .exec();

  return rows.map((row) => ({
    day: dayLabel(row.day),
    sessions: row.sessions ?? 0,
    minutes: Math.round(row.minutes ?? 0),
  }));
}

/**
 * Takes a player's name out of the activity history when the account is
 * deleted. Anonymised, not deleted, or numbers already read would move:
 * last month's active players would drop because somebody left. The name
 * becomes one random id stored nowhere else, one for the whole account so
 * "distinct" counts still see one person. This is why `cohort` is copied
 * onto each row rather than read from the player document.
 */
export async function forgetPlayer(name: string): Promise<number> {
  const anonymous = `deleted:${crypto.randomUUID()}`;
  const result = await PlayerDayModel.updateMany(
    { player: name },
    { $set: { player: anonymous } },
  ).exec();
  return result.modifiedCount ?? 0;
}
