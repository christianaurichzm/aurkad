import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from 'vitest';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startMemoryMongo } from '../../../test/mongo.js';

// The script editor flag comes from the environment, so pin it here instead
// of letting a developer's local .env decide what the responses assert.
vi.mock('../../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config.js')>();
  return {
    ...actual,
    config: { ...actual.config, scripting: { editorEnabled: false } },
  };
});

import { createAdminAuthRouter } from './adminAuthRoutes.js';
import {
  totpCode,
  twoFactorStatus,
} from '../../services/player/twoFactorService.js';
import PlayerModel from '../../model/Player.js';
import { createPlayer } from '../../services/player/playerService.js';
import { Access } from '../../../shared/types.js';

let mongod: MongoMemoryServer;
let app: express.Express;

const hashPw = (plain: string) => bcrypt.hash(plain, 4);

async function setAccess(username: string, access: Access) {
  await PlayerModel.updateOne({ name: username }, { $set: { access } });
}

beforeAll(async () => {
  mongod = await startMemoryMongo();
  await mongoose.connect(mongod.getUri());
}, 30_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

// A fresh app per test: the auth limiter counts per instance, so a router
// shared by the whole file leaves each test only the budget the ones before
// it did not spend, and the file as a whole has to fit in
// AUTH_RATE_LIMIT_MAX (20 by default).
beforeEach(async () => {
  app = express();
  app.use(express.json());
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false },
    }),
  );
  app.use(createAdminAuthRouter());

  const cols = mongoose.connection.collections;
  await Promise.all(Object.values(cols).map((c) => c.deleteMany({})));
  // Consume the "first player is admin" bootstrap slot.
  await createPlayer('_seed', await hashPw('seed'));
});

describe('POST /admin/login', () => {
  it('rejects unknown username and wrong password with 401', async () => {
    await createPlayer('Boss', await hashPw('pw'));
    await setAccess('Boss', Access.ADMIN);

    expect(
      (
        await request(app)
          .post('/admin/login')
          .send({ username: 'Ghost', password: 'x' })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post('/admin/login')
          .send({ username: 'Boss', password: 'wrong' })
      ).status,
    ).toBe(401);
  });

  it('rejects a non-mod account with 403', async () => {
    await createPlayer('Regular', await hashPw('pw'));

    const res = await request(app)
      .post('/admin/login')
      .send({ username: 'Regular', password: 'pw' });

    expect(res.status).toBe(403);
  });

  it('logs a mod in and exposes the session', async () => {
    await createPlayer('Helper', await hashPw('pw'));
    await setAccess('Helper', Access.MOD);

    const agent = request.agent(app);
    const login = await agent
      .post('/admin/login')
      .send({ username: 'Helper', password: 'pw' });

    expect(login.status).toBe(200);
    expect(login.body).toEqual({
      username: 'Helper',
      access: Access.MOD,
      scriptEditorEnabled: false,
    });

    const session = await agent.get('/admin/session');
    expect(session.status).toBe(200);
    expect(session.body.username).toBe('Helper');
  });
});

describe('GET /admin/session', () => {
  it('returns 401 without an authenticated session', async () => {
    expect((await request(app).get('/admin/session')).status).toBe(401);
  });
});

describe('the second factor on the panel', () => {
  /** A mod account with a session already open, where enrollment starts. */
  async function signedIn(name = 'Helper', password = 'pw') {
    await createPlayer(name, await hashPw(password));
    await setAccess(name, Access.MOD);
    const agent = request.agent(app);
    await agent.post('/admin/login').send({ username: name, password });
    return agent;
  }

  /** Runs the whole enrollment and answers with what the operator keeps. */
  async function enroll(agent: ReturnType<typeof request.agent>) {
    const setup = await agent
      .post('/admin/2fa/setup')
      .send({ currentPassword: 'pw' });
    expect(setup.status).toBe(200);

    const secret = setup.body.secret as string;
    const enabled = await agent
      .post('/admin/2fa/enable')
      .send({ totpToken: totpCode(secret) });
    expect(enabled.status).toBe(200);

    return { secret, recoveryCodes: enabled.body.recoveryCodes as string[] };
  }

  // The code that enrolled is spent, so a login seconds later needs the
  // next one, which the drift window accepts.
  const nextCode = (secret: string) => totpCode(secret, Date.now() + 30_000);

  it('reports itself off, and refuses to enroll on a wrong password', async () => {
    const agent = await signedIn();

    expect((await agent.get('/admin/2fa')).body).toEqual({
      enabled: false,
      recoveryLeft: 0,
    });
    expect(
      (await agent.post('/admin/2fa/setup').send({ currentPassword: 'nope' }))
        .status,
    ).toBe(403);
  });

  it('needs a session: setup is not reachable unauthenticated', async () => {
    expect(
      (
        await request(app)
          .post('/admin/2fa/setup')
          .send({ currentPassword: 'pw' })
      ).status,
    ).toBe(401);
  });

  it('hands out a secret the app can read, and confirms with a code', async () => {
    const agent = await signedIn();
    const setup = await agent
      .post('/admin/2fa/setup')
      .send({ currentPassword: 'pw' });

    expect(setup.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.body.otpauthUrl).toContain('otpauth://totp/');
    // Nothing is stored until a code comes back: an abandoned setup leaves an
    // account that can still log in with a password alone.
    expect((await twoFactorStatus('Helper')).enabled).toBe(false);

    const wrong = await agent
      .post('/admin/2fa/enable')
      .send({ totpToken: '000000' });
    expect(wrong.status).toBe(400);

    const enabled = await agent
      .post('/admin/2fa/enable')
      .send({ totpToken: totpCode(setup.body.secret as string) });
    expect(enabled.status).toBe(200);
    expect(enabled.body.recoveryCodes).toHaveLength(10);
    expect((await agent.get('/admin/2fa')).body).toEqual({
      enabled: true,
      recoveryLeft: 10,
    });
  });

  it('refuses to confirm an enrollment this session never started', async () => {
    const agent = await signedIn();

    const res = await agent
      .post('/admin/2fa/enable')
      .send({ totpToken: '000000' });

    expect(res.status).toBe(409);
  });

  it('asks the enrolled account for a code at the next login', async () => {
    const { secret } = await enroll(await signedIn());

    const bare = await request(app)
      .post('/admin/login')
      .send({ username: 'Helper', password: 'pw' });
    expect(bare.status).toBe(401);
    expect(bare.body.twoFactorRequired).toBe(true);

    const wrong = await request(app)
      .post('/admin/login')
      .send({ username: 'Helper', password: 'pw', totpToken: '000000' });
    expect(wrong.status).toBe(401);

    const right = await request(app)
      .post('/admin/login')
      .send({
        username: 'Helper',
        password: 'pw',
        totpToken: nextCode(secret),
      });
    expect(right.status).toBe(200);
    expect(right.body.username).toBe('Helper');
  });

  it('still refuses a wrong password when a code is offered', async () => {
    const { secret } = await enroll(await signedIn());

    const res = await request(app)
      .post('/admin/login')
      .send({
        username: 'Helper',
        password: 'wrong',
        totpToken: nextCode(secret),
      });

    expect(res.status).toBe(401);
    expect(res.body.twoFactorRequired).toBeUndefined();
  });

  it('takes a printed recovery code in place of the app', async () => {
    const { recoveryCodes } = await enroll(await signedIn());

    const res = await request(app).post('/admin/login').send({
      username: 'Helper',
      password: 'pw',
      totpToken: recoveryCodes[0],
    });

    expect(res.status).toBe(200);
    expect((await twoFactorStatus('Helper')).recoveryLeft).toBe(9);
  });

  it('turns off only for someone holding both halves', async () => {
    const agent = await signedIn();
    const { secret } = await enroll(agent);

    expect(
      (
        await agent
          .post('/admin/2fa/disable')
          .send({ currentPassword: 'nope', totpToken: nextCode(secret) })
      ).status,
    ).toBe(403);
    expect(
      (
        await agent
          .post('/admin/2fa/disable')
          .send({ currentPassword: 'pw', totpToken: '000000' })
      ).status,
    ).toBe(403);

    const off = await agent
      .post('/admin/2fa/disable')
      .send({ currentPassword: 'pw', totpToken: nextCode(secret) });
    expect(off.status).toBe(200);
    expect((await twoFactorStatus('Helper')).enabled).toBe(false);
  });
});
