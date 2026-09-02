import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from 'vitest';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startMemoryMongo } from '../../test/mongo.js';

const { analytics } = vi.hoisted(() => ({
  analytics: { enabled: true, retentionDays: 400 },
}));

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config.js')>();
  return { config: { ...actual.config, analytics } };
});

import PlayerDayModel from '../model/PlayerDay.js';
import PlayerModel from '../model/Player.js';
import {
  activityOf,
  flushAnalytics,
  dailyActivity,
  dayLabel,
  forgetPlayer,
  funnel,
  recordLogin,
  recordLogout,
  retention,
  startOfDay,
} from './analyticsService.js';

let mongod: MongoMemoryServer;

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => Date.now() - n * DAY;
const label = (n: number) => dayLabel(startOfDay(daysAgo(n)));

/**
 * An account registered `registeredDaysAgo` days ago. The `_id` is minted
 * from that moment, the document's insertion time the cohort is read from.
 */
async function makePlayer(name: string, registeredDaysAgo = 0, level = 1) {
  await PlayerModel.create({
    // Built by hand rather than with ObjectId.createFromTime, which zeroes
    // every byte after the timestamp: two accounts made in the same second
    // would come out with the same id.
    _id: new mongoose.Types.ObjectId(
      Math.floor(daysAgo(registeredDaysAgo) / 1000)
        .toString(16)
        .padStart(8, '0') + crypto.randomBytes(8).toString('hex'),
    ),
    id: `id-${name}`,
    name,
    password: 'x',
    level,
  });
}

/** A whole session: in at one moment, out at another. */
async function session(name: string, atDaysAgo: number, minutes = 10) {
  const at = daysAgo(atDaysAgo);
  recordLogin(name, at);
  recordLogout(name, at + minutes * 60_000);
  // The writes are fire-and-forget, as a login does not wait on measuring
  // itself, so the test joins them as the shutdown does. Waiting for the row
  // returns before the session length, a second write, lands.
  await flushAnalytics();
}

beforeAll(async () => {
  mongod = await startMemoryMongo();
  await mongoose.connect(mongod.getUri());
  await PlayerDayModel.syncIndexes();
}, 30_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  analytics.enabled = true;
  await PlayerDayModel.deleteMany({});
  await PlayerModel.deleteMany({});
});

describe('recording a session', () => {
  it('writes one row per player per day, however many logins', async () => {
    await makePlayer('Alice');
    await session('Alice', 0, 10);
    await session('Alice', 0, 5);

    const rows = await PlayerDayModel.find({ player: 'Alice' }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sessions).toBe(2);
    expect(rows[0]!.minutes).toBeCloseTo(15, 5);
  });

  it('takes the cohort from the day the account was made', async () => {
    await makePlayer('Veteran', 30);
    await session('Veteran', 0);

    const row = await PlayerDayModel.findOne({ player: 'Veteran' }).lean();
    expect(dayLabel(row!.cohort)).toBe(label(30));
    expect(dayLabel(row!.day)).toBe(label(0));
  });

  it('bills a session that crossed midnight to the day it started', async () => {
    await makePlayer('NightOwl');
    const start = startOfDay(daysAgo(1)).getTime() + 23.5 * 60 * 60 * 1000;
    recordLogin('NightOwl', start);
    recordLogout('NightOwl', start + 60 * 60 * 1000);
    await flushAnalytics();

    const rows = await PlayerDayModel.find({}).lean();
    expect(rows).toHaveLength(1);
    expect(dayLabel(rows[0]!.day)).toBe(label(1));
    expect(rows[0]!.minutes).toBeCloseTo(60, 5);
  });

  it('counts a session with no logout as a login with no time', async () => {
    await makePlayer('Crashed');
    recordLogin('Crashed', daysAgo(0));
    await flushAnalytics();

    const row = await PlayerDayModel.findOne({}).lean();
    expect(row!.sessions).toBe(1);
    expect(row!.minutes).toBe(0);
  });

  it('records nothing at all when it is switched off', async () => {
    await makePlayer('Alice');
    analytics.enabled = false;

    recordLogin('Alice', daysAgo(0));
    recordLogout('Alice', daysAgo(0) + 60_000);

    await flushAnalytics();
    expect(await PlayerDayModel.countDocuments({})).toBe(0);
  });

  // The trap the economy census documents: a plain index declared on the same
  // key as a TTL index makes mongoose create the plain one and skip the TTL,
  // which is retention silently not happening.
  it('really has the expiring index the retention setting promises', async () => {
    const indexes = await PlayerDayModel.collection.indexes();
    const ttl = indexes.find((index) => index.expireAfterSeconds !== undefined);

    expect(ttl?.key).toEqual({ day: 1 });
    expect(ttl?.expireAfterSeconds).toBe(400 * 24 * 60 * 60);
  });
});

describe('daily activity', () => {
  it('counts people and not logins, and marks the ones who are new', async () => {
    await makePlayer('Alice');
    await makePlayer('Bob');
    await makePlayer('Carol', 10);

    await session('Alice', 0, 10);
    await session('Alice', 0, 20); // same person, same day
    await session('Bob', 0, 5);
    await session('Carol', 0, 30);

    const [today] = await dailyActivity(1);
    expect(today).toEqual({
      day: label(0),
      players: 3,
      newPlayers: 2, // Carol registered ten days ago
      sessions: 4,
      minutes: 65,
    });
  });

  it('gives a row per day, oldest first, and skips days nobody played', async () => {
    await makePlayer('Alice', 5);
    await session('Alice', 3);
    await session('Alice', 0);

    const rows = await dailyActivity(7);

    expect(rows.map((row) => row.day)).toEqual([label(3), label(0)]);
  });
});

describe('retention', () => {
  it('answers how many of an arrival day came back on day 1 and day 7', async () => {
    await makePlayer('Stayed', 8);
    await makePlayer('Returned', 8);
    await makePlayer('Left', 8);

    await session('Stayed', 8);
    await session('Stayed', 7); // d1
    await session('Stayed', 1); // d7
    await session('Returned', 8);
    await session('Returned', 7); // d1 only
    await session('Left', 8);

    const [cohort] = await retention(10);

    expect(cohort).toEqual({
      cohort: label(8),
      players: 3,
      returned: { 1: 2, 7: 1, 30: 0 },
    });
  });

  it('counts a player who arrived and never played as absent, not as retained', async () => {
    await makePlayer('Ghost', 3);
    await makePlayer('Player', 3);
    await session('Player', 3);

    const [cohort] = await retention(5);

    // Ghost has no row at all, so the cohort here is "arrived and played".
    // The funnel is what puts the registered-but-never-played back in.
    expect(cohort?.players).toBe(1);
  });
});

describe('funnel', () => {
  it('walks registered, played, came back and got somewhere', async () => {
    await makePlayer('NeverPlayed', 5, 1);
    await makePlayer('PlayedOnce', 5, 2);
    await makePlayer('CameBack', 5, 9);
    await makePlayer('OldTimer', 90, 40);

    await session('PlayedOnce', 5);
    await session('CameBack', 5);
    await session('CameBack', 2);
    await session('OldTimer', 0);

    const result = await funnel(30, 5);

    expect(result).toMatchObject({
      registered: 3, // OldTimer is outside the window
      played: 2,
      returned: 1,
      level: 5,
      reachedLevel: 1, // CameBack, at level 9
    });
  });
});

describe('what is stored about one person', () => {
  it('reads back their own days for the account export', async () => {
    await makePlayer('Alice', 2);
    await session('Alice', 2, 12);
    await session('Alice', 0, 8);

    expect(await activityOf('Alice')).toEqual([
      { day: label(2), sessions: 1, minutes: 12 },
      { day: label(0), sessions: 1, minutes: 8 },
    ]);
  });

  // Deleting the rows would move a number that has already been read: the day
  // an account was active is part of that day's player count.
  it('anonymises on erasure, and the counts do not move', async () => {
    await makePlayer('Alice');
    await makePlayer('Bob');
    await session('Alice', 0);
    await session('Bob', 0);

    const before = await dailyActivity(1);
    expect(await forgetPlayer('Alice')).toBe(1);

    expect(await dailyActivity(1)).toEqual(before);
    expect(await activityOf('Alice')).toEqual([]);
    expect(await PlayerDayModel.countDocuments({ player: /^deleted:/ })).toBe(
      1,
    );
  });

  it('gives one id to the whole account, not one per day', async () => {
    await makePlayer('Alice', 3);
    await session('Alice', 3);
    await session('Alice', 1);

    expect(await forgetPlayer('Alice')).toBe(2);

    const names = await PlayerDayModel.distinct('player');
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^deleted:/);
  });
});
