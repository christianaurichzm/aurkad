/**
 * The access gate, and the trail it leaves. The audit hangs off this
 * middleware, the one place every privileged route passes, so these pin that
 * the gate logs, which covers a route added tomorrow too.
 */
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Router } from 'express';
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

  // Refused at the gate, the request never reaches the console, so the gate is
  // the only place it can be recorded.
  it('still records a refused console attempt', async () => {
    await request(app)
      .post('/admin/console')
      .set('x-user', 'player')
      .set('x-access', String(Access.USER))
      .send({ line: '/kick alice' });
    await settled();

    const [entry] = await listAuditLog();
    expect(entry).toMatchObject({
      actor: 'player',
      action: 'POST /admin/console',
      outcome: 'denied',
      status: 403,
    });
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

/**
 * Who may call each route in http/routes, as the routes themselves answer it.
 *
 * Listed rather than inferred, so the list is the decision: a route missing
 * from it fails the first test below, and nobody ships an endpoint without
 * saying who it is for. 'session' is a route that checks the login itself
 * instead of through the gate (account screens, the admin panel's probe).
 */
const GATES: Record<string, 'public' | 'session' | Access> = {
  'GET /admin/session': 'session',
  'POST /admin/login': 'public',
  'GET /admin/audit': Access.ADMIN,
  'GET /admin/2fa': Access.MOD,
  'POST /admin/2fa/setup': Access.MOD,
  'POST /admin/2fa/enable': Access.MOD,
  'POST /admin/2fa/disable': Access.MOD,
  'POST /admin/logout': 'public',
  'POST /openMapEditor': Access.ADMIN,
  'POST /openModEditor': Access.MOD,
  'POST /openContentEditor': Access.ADMIN,

  'GET /assets/tiles.json': 'public',
  'GET /assets/sprites.json': 'public',
  'GET /assets/:name.png': 'public',
  'PUT /admin/assets/:sheet': Access.ADMIN,
  'GET /audio/:filename': 'public',

  'POST /login': 'public',
  'POST /logout': 'public',
  'POST /register': 'public',
  'GET /auth/capabilities': 'public',
  'GET /email': 'session',
  'POST /email': 'session',
  'GET /email/confirm': 'public',
  'POST /password': 'session',
  'POST /password/reset': 'public',
  'POST /password/reset/confirm': 'public',

  'GET /admin/commands': Access.MOD,
  'POST /admin/console': Access.MOD,

  ...Object.fromEntries(
    ['npcs', 'items', 'spells', 'arrows'].flatMap((kind) => [
      [`GET /${kind}`, Access.ADMIN],
      [`POST /${kind}`, Access.ADMIN],
      [`PUT /${kind}/:id`, Access.ADMIN],
      [`DELETE /${kind}/:id`, Access.ADMIN],
    ]),
  ),
  ...Object.fromEntries(
    ['loot', 'dialogs', 'quests', 'recipes'].flatMap((kind) => [
      [`GET /${kind}`, Access.ADMIN],
      [`POST /${kind}`, Access.ADMIN],
      [`DELETE /${kind}/:id`, Access.ADMIN],
    ]),
  ),
  'GET /dialogs/refs': Access.ADMIN,
  'GET /behaviors': Access.ADMIN,

  'GET /game': 'public',
  'GET /theme/theme.css': 'public',
  'GET /healthz': 'public',
  'GET /readyz': 'public',

  'POST /saveMap': Access.ADMIN,
  'GET /maps': Access.ADMIN,
  'GET /maps/:mapId': Access.ADMIN,
  'POST /maps': Access.ADMIN,
  'PUT /maps/:id': Access.ADMIN,
  'POST /maps/:id/resize': Access.ADMIN,

  // Or METRICS_TOKEN as a bearer token, which no request here carries.
  'GET /metrics': Access.ADMIN,
  'POST /client-error': 'public',
  'GET /debug/net': Access.ADMIN,

  'POST /mod/changeSprite': Access.MOD,
  'POST /mod/kick': Access.MOD,
  'POST /mod/ban': Access.ADMIN,
  'POST /mod/bring': Access.MOD,
  'POST /mod/goto': Access.MOD,
  'POST /mod/warp': Access.MOD,
  'POST /mod/setSprite': Access.MOD,
  'POST /mod/setAccess': Access.ADMIN,
  'POST /mod/setMyAccess': Access.ADMIN,

  'GET /modules': 'public',
  'GET /modules/loaded': 'public',
  'GET /modules/:id/client': 'public',

  'GET /players/online': Access.USER,
  'POST /players/:id/assignPoints': Access.USER,

  'GET /admin/scripts': Access.ADMIN,
  'GET /admin/scripts/types': Access.ADMIN,
  'GET /admin/scripts/errors': Access.ADMIN,
  'GET /admin/scripts/:name': Access.ADMIN,
  'PUT /admin/scripts/:name': Access.ADMIN,
  'POST /admin/scripts': Access.ADMIN,
  'DELETE /admin/scripts/:name': Access.ADMIN,

  'GET /shops': Access.ADMIN,
  'GET /shop/:shopId': 'public',
  'POST /shops': Access.ADMIN,
  'PUT /shops/:id': Access.ADMIN,
  'DELETE /shops/:id': Access.ADMIN,
  'POST /shop/buy': Access.USER,

  'GET /admin/theme': Access.ADMIN,
  'PUT /admin/theme': Access.ADMIN,
  'PUT /admin/theme/:slot': Access.ADMIN,
  'DELETE /admin/theme/:slot': Access.ADMIN,
};

// Every router factory in http/routes, found on disk so that a new file is
// covered the day it lands rather than the day someone adds it here.
const routesDir = path.resolve(process.cwd(), 'src/server/http/routes');
const routers: Router[] = (
  await Promise.all(
    fs
      .readdirSync(routesDir)
      .filter((file) => file.endsWith('Routes.ts'))
      .map(async (file) => {
        const mod = (await import(path.join(routesDir, file))) as Record<
          string,
          unknown
        >;
        return Object.entries(mod)
          .filter(([name]) => /^create\w+Router$/.test(name))
          .map(([, create]) => (create as () => Router)());
      }),
  )
).flat();

type RouteLayer = {
  route?: { path: string | string[]; methods: Record<string, boolean> };
};

const routes = routers.flatMap((router) =>
  (router as unknown as { stack: RouteLayer[] }).stack.flatMap(({ route }) =>
    route
      ? [route.path].flat().flatMap((pattern) =>
          Object.keys(route.methods).map((method) => ({
            key: `${method.toUpperCase()} ${pattern}`,
            method,
            url: pattern.replace(/:\w+/g, 'x'),
            router,
          })),
        )
      : [],
  ),
);

type Route = (typeof routes)[number];

function call({ method, url, router }: Route, access?: Access): request.Test {
  const app = express();
  app.use(express.json());
  app.use(fakeSession);
  app.use(router);
  const req = (
    request(app) as unknown as Record<string, (url: string) => request.Test>
  )[method]!(url);
  return access === undefined
    ? req
    : req.set('x-user', 'probe').set('x-access', String(access));
}

/** The entries one action left, once `count` of them have landed. */
async function entriesFor(action: string, count: number) {
  const deadline = Date.now() + LAND_MS;
  for (;;) {
    const entries = await AuditLogModel.find({ action }).lean();
    if (entries.length >= count || Date.now() > deadline) return entries;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('every route crosses the gate', () => {
  it('names a gate for every route, and only for routes that exist', () => {
    const keys = routes.map((r) => r.key);
    expect(keys.filter((key) => !(key in GATES))).toEqual([]);
    expect(Object.keys(GATES).filter((key) => !keys.includes(key))).toEqual([]);
  });

  const gated = routes.filter((r) => typeof GATES[r.key] === 'number');

  it.each(gated)('$key refuses whoever is below it', async (route) => {
    const required = GATES[route.key] as Access;

    await call(route).expect(401);
    if (required > Access.USER) await call(route, required - 1).expect(403);
  });

  // The refusal is only half of it: the level written into the entry is what
  // the route asked for, which pins it exactly without running the handler,
  // and an entry at all is what proves the route went through the gate rather
  // than a check of its own that the trail never hears about.
  it.each(gated.filter((r) => r.method !== 'get'))(
    '$key leaves a trail when it refuses',
    async (route) => {
      const required = GATES[route.key] as Access;
      await call(route);
      if (required > Access.USER) await call(route, required - 1);

      const refusals = required > Access.USER ? 2 : 1;
      const entries = await entriesFor(
        `${route.method.toUpperCase()} ${route.url}`,
        refusals,
      );
      expect(
        entries.map((e) => [e.status, e.outcome, e.requiredAccess]).sort(),
      ).toEqual(
        [
          [401, 'denied', required],
          [403, 'denied', required],
        ].slice(0, refusals),
      );
    },
  );

  // Reads leave no trail to read the level from, but they are safe to run, so
  // a caller at the level is let through to see that the gate is not set
  // higher than the table says.
  it.each(gated.filter((r) => r.method === 'get'))(
    '$key lets a caller at its level through',
    async (route) => {
      const res = await call(route, GATES[route.key] as Access);
      expect([401, 403]).not.toContain(res.status);
    },
  );

  it.each(routes.filter((r) => GATES[r.key] === 'session'))(
    '$key refuses a caller with no session',
    async (route) => {
      await call(route).expect(401);
    },
  );
});
