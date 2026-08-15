/**
 * The administrative trail.
 *
 * Two properties carry the feature: an entry can never leak a credential (a
 * password kept in a log that outlives the session is a leak the log itself
 * created), and the collection cannot grow without bound. The rest is query
 * shape, which is what makes the trail usable rather than merely present.
 */
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startMemoryMongo } from '../../test/mongo.js';
import AuditLogModel from '../model/AuditLog.js';
import {
  listAuditLog,
  recordAdminAction,
  summarizeDetails,
} from './auditService.js';
import {
  clearCommands,
  handleChatCommand,
  handleReplCommand,
  handleWebCommand,
  registerCommand,
} from '../engine/commands.js';
import { drainGameEvents } from '../engine/eventBus.js';
import { createFixture } from '../sim/simFixture.js';
import { Access } from '../../shared/types.js';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await startMemoryMongo();
  await mongoose.connect(mongod.getUri());
  // Indexes are built up front, as in checkAccess.test.ts, which says what
  // building them on the first insert cost.
  await AuditLogModel.init();
}, 30_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await AuditLogModel.deleteMany({});
});

/**
 * recordAdminAction is fire and forget, so a test has to wait for the write
 * rather than assume it. A turn of the event loop is not enough: the insert
 * is a real round trip, and asserting before it lands reads an empty log.
 */
async function record(entry: Parameters<typeof recordAdminAction>[0]) {
  // `at` is a Date, so two entries in the same millisecond sort arbitrarily,
  // and the tests below assert newest first; spacing the writes makes the
  // order a fact.
  await new Promise((resolve) => setTimeout(resolve, 2));
  const before = await AuditLogModel.countDocuments();
  recordAdminAction(entry);
  await settled(before + 1);
}

/**
 * Resolves once `expected` entries exist, and throws on timeout, so a slow
 * write does not surface as `expected undefined to match object`.
 */
async function settled(expected: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if ((await AuditLogModel.countDocuments()) >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(
    `only ${await AuditLogModel.countDocuments()} of ${expected} audit ` +
      `entries landed within 5000ms - the write is fire and forget, so this ` +
      `is a slow or failed insert, not a wrong assertion`,
  );
}

describe('summarizeDetails', () => {
  it('redacts anything that looks like a credential', () => {
    const details = summarizeDetails({
      username: 'alice',
      password: 'hunter2',
      apiToken: 'abc',
      passwordHash: 'x',
    });

    expect(details).toEqual({
      username: 'alice',
      password: '[redacted]',
      apiToken: '[redacted]',
      passwordHash: '[redacted]',
    });
  });

  // /saveMap carries an entire tile grid. A hundred of those would make the
  // trail bigger than the content it describes.
  it('records the shape of a big value, not the value', () => {
    const details = summarizeDetails({
      mapId: 'town',
      tiles: [[], [], []],
      meta: { a: 1, b: 2 },
      content: 'x'.repeat(500),
    });

    expect(details).toEqual({
      mapId: 'town',
      tiles: '[3 items]',
      meta: '{2 keys}',
      content: '[500 chars]',
    });
  });

  it('keeps short values as they are, which is what gets read', () => {
    expect(
      summarizeDetails({ reason: 'spam', days: 3, permanent: true }),
    ).toEqual({ reason: 'spam', days: 3, permanent: true });
  });

  it('has nothing to say about an empty or non-object body', () => {
    expect(summarizeDetails({})).toBeUndefined();
    expect(summarizeDetails(undefined)).toBeUndefined();
    expect(summarizeDetails('kick')).toBeUndefined();
    expect(summarizeDetails([1, 2])).toBeUndefined();
  });
});

describe('recordAdminAction', () => {
  it('stores who did what to whom', async () => {
    await record({
      actor: 'gm',
      actorAccess: 1,
      requiredAccess: 1,
      action: 'POST /mod/kick',
      target: 'alice',
      outcome: 'allowed',
      status: 200,
      source: 'http',
      ip: '10.0.0.1',
    });

    const [entry] = await listAuditLog();
    expect(entry).toMatchObject({
      actor: 'gm',
      action: 'POST /mod/kick',
      target: 'alice',
      outcome: 'allowed',
      status: 200,
      source: 'http',
    });
    expect(entry?.at).toBeGreaterThan(0);
  });

  // The audited action already happened; losing the entry is bad, but failing
  // the request that produced it is worse.
  it('never throws at the caller', async () => {
    await mongoose.disconnect();
    expect(() =>
      recordAdminAction({
        action: 'POST /mod/ban',
        outcome: 'allowed',
        source: 'http',
      }),
    ).not.toThrow();
    await mongoose.connect(mongod.getUri());
  });
});

describe('listAuditLog', () => {
  beforeEach(async () => {
    await record({
      actor: 'gm',
      action: 'POST /mod/kick',
      target: 'alice',
      outcome: 'allowed',
      source: 'http',
    });
    await record({
      actor: 'gm',
      action: 'POST /mod/ban',
      target: 'bob',
      outcome: 'denied',
      source: 'http',
    });
    await record({
      actor: 'owner',
      action: 'command give',
      target: 'carol',
      outcome: 'allowed',
      source: 'chat',
    });
  });

  it('returns newest first', async () => {
    const rows = await listAuditLog();
    expect(rows.map((r) => r.action)).toEqual([
      'command give',
      'POST /mod/ban',
      'POST /mod/kick',
    ]);
  });

  it('narrows to one operator, which is the usual question', async () => {
    const rows = await listAuditLog({ actor: 'gm' });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.actor === 'gm')).toBe(true);
  });

  // "What did anyone try in /mod" is a prefix question, not an exact one.
  it('matches an action by prefix', async () => {
    const rows = await listAuditLog({ action: 'POST /mod' });
    expect(rows).toHaveLength(2);
  });

  it('shows refused attempts on their own', async () => {
    const rows = await listAuditLog({ outcome: 'denied' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.target).toBe('bob');
  });

  it('pages backwards from a timestamp', async () => {
    const all = await listAuditLog();
    const older = await listAuditLog({ before: all[0]!.at });
    expect(older.length).toBe(all.length - 1);
    expect(older[0]?.action).toBe(all[1]?.action);
  });

  it('caps the page size a caller can ask for', async () => {
    const rows = await listAuditLog({ limit: 10_000 });
    expect(rows.length).toBeLessThanOrEqual(200);
  });

  // Otherwise a filter of "gm.*" or similar would be a regex the caller wrote
  // into our query.
  it('treats a filter as text, not as a pattern', async () => {
    expect(await listAuditLog({ action: 'POST /mod/.*' })).toEqual([]);
  });
});

describe('retention', () => {
  it('expires entries through a TTL index, so nobody has to prune', async () => {
    await AuditLogModel.syncIndexes();
    const indexes = await AuditLogModel.collection.indexes();
    const ttl = indexes.find((i) => i.expireAfterSeconds !== undefined);

    expect(ttl?.key).toEqual({ at: 1 });
    expect(ttl?.expireAfterSeconds).toBeGreaterThan(0);
  });
});

// The route trail is only half the surface: a GM kicks or hands out an item
// from in-game chat far more often than from an HTTP call.
describe('privileged commands', () => {
  beforeEach(() => {
    clearCommands();
    drainGameEvents();
  });

  it('records a command only players with a level can run', async () => {
    const sim = createFixture(0);
    const gm = sim.addPlayer({ name: 'Gm', access: Access.MOD });
    registerCommand('kick', { access: Access.MOD }, () => {});

    handleChatCommand(gm, '/kick alice');
    await settled(1);

    const [entry] = await listAuditLog();
    expect(entry).toMatchObject({
      actor: 'Gm',
      action: 'command kick',
      target: 'alice',
      outcome: 'allowed',
      source: 'chat',
      details: { args: 'alice' },
    });
  });

  // /who is not an administrative action, and a trail full of them is a
  // trail nobody reads.
  it('ignores a command anyone can run', async () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice' });
    registerCommand('who', {}, () => {});

    handleChatCommand(player, '/who');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(await listAuditLog()).toEqual([]);
  });

  // The dashboard console is a browser session, not the server terminal, and
  // recording it as the terminal would put a wrong actor in the trail.
  it('separates the web console from the terminal', async () => {
    registerCommand('ban', { access: Access.ADMIN }, () => {});

    await handleWebCommand('ban', ['bob'], Access.ADMIN, () => {}, 'owner');
    await handleReplCommand('ban', ['carol'], () => {});
    await settled(2);

    // Sorted by source rather than taken as listed: these two are written
    // within the same millisecond, and `at` is a Date, so the newest-first sort
    // has nothing to break the tie with. What this test is about is that the
    // two consoles are told apart, not which of them lands first.
    const rows = await listAuditLog();
    const seen = rows
      .map((r) => [r.source, r.actor, r.target])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    expect(seen).toEqual([
      ['repl', 'console', 'carol'],
      ['web', 'owner', 'bob'],
    ]);
  });

  it('records a console attempt above the caller level', async () => {
    registerCommand('ban', { access: Access.ADMIN }, () => {});

    await handleWebCommand('ban', ['bob'], Access.MOD, () => {}, 'gm');
    await settled(1);

    const [entry] = await listAuditLog();
    expect(entry).toMatchObject({
      actor: 'gm',
      actorAccess: Access.MOD,
      requiredAccess: Access.ADMIN,
      outcome: 'denied',
      source: 'web',
    });
  });
});
