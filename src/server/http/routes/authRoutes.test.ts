import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { WebSocket } from 'ws';
import { createAuthRouter } from './authRoutes.js';
import PlayerModel from '../../model/Player.js';
import { createPlayer } from '../../services/player/playerService.js';
import { banPlayer, getBan } from '../../services/content/banService.js';
import { serverState } from '../../services/world/serverState.js';
import { playersWsMap } from '../../net/connections.js';
import { getPlayerByName } from '../../sim/world.js';
import { runtimeState } from '../../sim/state.js';
import { createFixture, makeTiles } from '../../sim/simFixture.js';
import { gameConfig } from '../../gameConfig.js';
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
  app.use(createAuthRouter());
}, 30_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  const cols = mongoose.connection.collections;
  await Promise.all(Object.values(cols).map((c) => c.deleteMany({})));

  createFixture(0);
  const startMapId = gameConfig.world.startMapId;
  runtimeState.maps[startMapId] = {
    id: startMapId,
    name: 'Start',
    type: 'normal',
    tiles: makeTiles(20, 20),
    droppedItems: [],
    npcs: {},
    players: {},
  };

  playersWsMap.clear();
  serverState.mode = 'normal';
  serverState.motd = '';

  // Consume the "first player becomes admin" bootstrap slot so test users
  // created afterward get plain USER access by default.
  await createPlayer('_seed', await hashPw('seed'));
});

describe('POST /register', () => {
  it('creates a new player', async () => {
    const res = await request(app)
      .post('/register')
      .send({ username: 'Newbie', password: 'secret123' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.playerId).toEqual(expect.any(String));
  });

  it('rejects a duplicate username with 409', async () => {
    await createPlayer('Taken', await hashPw('secret123'));

    const res = await request(app)
      .post('/register')
      .send({ username: 'Taken', password: 'secret123' });

    expect(res.status).toBe(409);
  });

  it('rejects an invalid body with 400', async () => {
    const res = await request(app).post('/register').send({ username: '' });

    expect(res.status).toBe(400);
  });
});

describe('POST /login', () => {
  it('rejects an unknown username with 401', async () => {
    const res = await request(app)
      .post('/login')
      .send({ username: 'Ghost', password: 'whatever' });

    expect(res.status).toBe(401);
  });

  it('rejects a wrong password with 401', async () => {
    await createPlayer('Alice', await hashPw('rightpassword'));

    const res = await request(app)
      .post('/login')
      .send({ username: 'Alice', password: 'wrongpassword' });

    expect(res.status).toBe(401);
  });

  it('rejects an invalid body with 400', async () => {
    const res = await request(app).post('/login').send({ username: 'x' });

    expect(res.status).toBe(400);
  });

  it('logs in with valid credentials, sets the session and places the player on the start map', async () => {
    await createPlayer('Alice', await hashPw('correcthorse'));

    const res = await request(app)
      .post('/login')
      .send({ username: 'Alice', password: 'correcthorse' });

    expect(res.status).toBe(200);
    expect(res.body.player.name).toBe('Alice');
    expect(res.body.map?.id).toBe(gameConfig.world.startMapId);
    expect(res.headers['set-cookie']).toBeDefined();
    expect(getPlayerByName('Alice')).toBeDefined();
  });

  it('rejects a banned player with 403', async () => {
    await createPlayer('Banned', await hashPw('pw'));
    await banPlayer('Banned', 'spamming', undefined);

    const res = await request(app)
      .post('/login')
      .send({ username: 'Banned', password: 'pw' });

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('banned');
  });

  it('auto-clears an expired ban and allows login', async () => {
    await createPlayer('WasBanned', await hashPw('pw'));
    await banPlayer('WasBanned', 'temp', Date.now() - 1000);

    const res = await request(app)
      .post('/login')
      .send({ username: 'WasBanned', password: 'pw' });

    expect(res.status).toBe(200);
    expect(await getBan('WasBanned')).toBeNull();
  });

  it('blocks a regular user during maintenance mode with 503', async () => {
    await createPlayer('Regular', await hashPw('pw'));
    serverState.mode = 'maintenance';

    const res = await request(app)
      .post('/login')
      .send({ username: 'Regular', password: 'pw' });

    expect(res.status).toBe(503);
  });

  it('allows an admin during maintenance mode', async () => {
    await createPlayer('Boss', await hashPw('pw'));
    await setAccess('Boss', Access.ADMIN);
    serverState.mode = 'maintenance';

    const res = await request(app)
      .post('/login')
      .send({ username: 'Boss', password: 'pw' });

    expect(res.status).toBe(200);
  });

  it('blocks a regular user in gm_only mode with 503', async () => {
    await createPlayer('Regular', await hashPw('pw'));
    serverState.mode = 'gm_only';

    const res = await request(app)
      .post('/login')
      .send({ username: 'Regular', password: 'pw' });

    expect(res.status).toBe(503);
  });

  it('allows a mod in gm_only mode', async () => {
    await createPlayer('Helper', await hashPw('pw'));
    await setAccess('Helper', Access.MOD);
    serverState.mode = 'gm_only';

    const res = await request(app)
      .post('/login')
      .send({ username: 'Helper', password: 'pw' });

    expect(res.status).toBe(200);
  });

  it('rejects a login when the account already has an open WS connection', async () => {
    await createPlayer('Online', await hashPw('pw'));
    playersWsMap.set('Online', { readyState: WebSocket.OPEN } as WebSocket);

    const res = await request(app)
      .post('/login')
      .send({ username: 'Online', password: 'pw' });

    expect(res.status).toBe(409);
  });
});

describe('POST /logout', () => {
  it('destroys the session and unregisters the player', async () => {
    await createPlayer('Alice', await hashPw('correcthorse'));
    const agent = request.agent(app);

    await agent
      .post('/login')
      .send({ username: 'Alice', password: 'correcthorse' });
    expect(getPlayerByName('Alice')).toBeDefined();

    const res = await agent.post('/logout');
    expect(res.status).toBe(200);

    // disconnectPlayer runs fire-and-forget after the session is destroyed
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(getPlayerByName('Alice')).toBeUndefined();
  });
});
