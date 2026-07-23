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
import { MongoMemoryServer } from 'mongodb-memory-server';

// The script editor flag comes from the environment, so pin it here instead
// of letting a developer's local .env decide what the responses assert.
vi.mock('../../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config.js')>();
  return {
    config: { ...actual.config, scripting: { editorEnabled: false } },
  };
});

import { createAdminAuthRouter } from './adminAuthRoutes.js';
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
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

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
}, 30_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
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
