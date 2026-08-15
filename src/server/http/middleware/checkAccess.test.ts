/**
 * The access gate, and the trail it leaves. The audit hangs off this
 * middleware, the one place every privileged route passes, so these pin that
 * the gate logs, which covers a route added tomorrow too.
 */
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startMemoryMongo } from '../../../test/mongo.js';
import checkAccess from './checkAccess.js';
import AuditLogModel from '../../model/AuditLog.js';
import { listAuditLog } from '../../services/auditService.js';
import { Access } from '../../../shared/types.js';

let mongod: MongoMemoryServer;
let app: express.Express;

// Stands in for the session middleware: each request declares who it is.
const fakeSession: express.RequestHandler = (req, _res, next) => {
  const username = req.get('x-user');
  const access = req.get('x-access');
  (req as unknown as { session: Record<string, unknown> }).session =
    username === undefined
      ? {}
      : { username, accessLevel: Number(access ?? Access.USER) };
  next();
};

beforeAll(async () => {
  mongod = await startMemoryMongo();
  await mongoose.connect(mongod.getUri());
  // Builds the indexes up front: AuditLog declares six, and creating them on
  // the first insert takes ~700ms, past the wait below, so the suite would
  // pass or fail on machine load.
  await AuditLogModel.init();

  app = express();
  app.use(express.json());
  app.use(fakeSession);
  app.post('/mod/kick', checkAccess(Access.MOD), (req, res) => {
    res.status(200).json({ ok: true });
  });
  app.post('/mod/ban', checkAccess(Access.ADMIN), (_req, res) => {
    res.status(422).json({ error: 'not a real player' });
  });
  app.get('/npcs', checkAccess(Access.ADMIN), (_req, res) => {
    res.json([]);
  });
  app.post('/admin/console', checkAccess(Access.MOD), (_req, res) => {
    res.json({ output: [] });
  });
}, 30_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await AuditLogModel.deleteMany({});
});

const QUIET_MS = 200;
const LAND_MS = 5_000;

/**
 * Waits for the entry, written on response finish and never awaited by the
 * request. Throws when nothing lands, so a timeout reads as one and not as
 * `expected undefined to match object` below.
 */
async function settled(): Promise<void> {
  const deadline = Date.now() + LAND_MS;
  while (Date.now() < deadline) {
    if ((await AuditLogModel.countDocuments()) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(
    `no audit entry was written within ${LAND_MS}ms - the write is fire and ` +
      `forget, so this is a slow or failed insert, not a wrong assertion`,
  );
}

/**
 * The wait for the tests that assert NOTHING was recorded.
 *
 * Separate from `settled` because those two cannot share a helper: one fails
 * when the deadline passes, the other needs the deadline to pass.
 */
async function quiet(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, QUIET_MS));
}

describe('access control', () => {
  it('refuses an anonymous caller', async () => {
    await request(app).post('/mod/kick').expect(401);
  });

  it('refuses a caller below the required level', async () => {
    await request(app)
      .post('/mod/ban')
      .set('x-user', 'gm')
      .set('x-access', String(Access.MOD))
      .expect(403);
  });

  it('lets a caller at or above the level through', async () => {
    await request(app)
      .post('/mod/kick')
      .set('x-user', 'gm')
      .set('x-access', String(Access.MOD))
      .expect(200);
  });
});

describe('audit trail', () => {
  it('records who acted, on whom, and from where', async () => {
    await request(app)
      .post('/mod/kick')
      .set('x-user', 'gm')
      .set('x-access', String(Access.MOD))
      .send({ username: 'alice', reason: 'spam' });
    await settled();

    const [entry] = await listAuditLog();
    expect(entry).toMatchObject({
      actor: 'gm',
      actorAccess: Access.MOD,
      requiredAccess: Access.MOD,
      action: 'POST /mod/kick',
      target: 'alice',
      outcome: 'allowed',
      status: 200,
      source: 'http',
      details: { username: 'alice', reason: 'spam' },
    });
  });

  // An account probing endpoints above its level is exactly what the log is
  // for, so a refusal has to leave a mark rather than vanish as a 403.
  it('records a refused attempt, with the level it wanted', async () => {
    await request(app)
      .post('/mod/ban')
      .set('x-user', 'gm')
      .set('x-access', String(Access.MOD))
      .send({ username: 'alice' });
    await settled();

    const [entry] = await listAuditLog();
    expect(entry).toMatchObject({
      actor: 'gm',
      actorAccess: Access.MOD,
      requiredAccess: Access.ADMIN,
      outcome: 'denied',
      status: 403,
      target: 'alice',
    });
  });

  it('records an anonymous attempt too, with no actor to name', async () => {
    await request(app).post('/mod/kick').send({ username: 'alice' });
    await settled();

    const [entry] = await listAuditLog();
    expect(entry).toMatchObject({ outcome: 'denied', status: 401 });
    expect(entry?.actor).toBeUndefined();
  });

  // The status is the difference between "banned someone" and "typed a name
  // that does not exist", and an entry claiming the first would be a lie.
  it('records the outcome of the request, not the intent', async () => {
    await request(app)
      .post('/mod/ban')
      .set('x-user', 'owner')
      .set('x-access', String(Access.ADMIN))
      .send({ username: 'ghost' });
    await settled();

    const [entry] = await listAuditLog();
    expect(entry).toMatchObject({ outcome: 'allowed', status: 422 });
  });

  // A trail of who looked at the npc list buries the entries that matter.
  it('ignores reads', async () => {
    await request(app)
      .get('/npcs')
      .set('x-user', 'owner')
      .set('x-access', String(Access.ADMIN))
      .expect(200);
    await quiet();

    expect(await listAuditLog()).toEqual([]);
  });

  // The console records the command and its arguments itself; the request
  // version would only double it.
  it('leaves the web console to record itself', async () => {
    await request(app)
      .post('/admin/console')
      .set('x-user', 'gm')
      .set('x-access', String(Access.MOD))
      .send({ line: '/kick alice' });
    await quiet();

    expect(await listAuditLog()).toEqual([]);
  });

  it('never stores a credential that passed through a body', async () => {
    await request(app)
      .post('/mod/kick')
      .set('x-user', 'owner')
      .set('x-access', String(Access.ADMIN))
      .send({ username: 'alice', password: 'hunter2' });
    await settled();

    const [entry] = await listAuditLog();
    expect(entry?.details).toMatchObject({ password: '[redacted]' });
  });
});
