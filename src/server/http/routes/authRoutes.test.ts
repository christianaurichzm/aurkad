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
import {
  enableTwoFactor,
  totpCode,
} from '../../services/player/twoFactorService.js';

// The other instance, which only exists as an answer here: whether a lease can
// be taken is decided in Mongo and tested in persistence/presence.test.ts, and
// what this file owns is what the route does with the answer.
type PresenceAnswer = { ok: true } | { ok: false; owner: string };
const presence = vi.hoisted((): { answer: PresenceAnswer } => ({
  answer: { ok: true },
}));
vi.mock('../../persistence/presence.js', () => ({
  acquirePresence: () => Promise.resolve(presence.answer),
  releasePresence: () => Promise.resolve(),
  releaseAllPresence: () => Promise.resolve(),
  renewPresence: () => Promise.resolve(),
  presenceFence: () => ({}),
}));

// A deployment that can send mail, and a record of what it sent: the address
// routes exist to put a link in somebody's inbox, so the assertion is the mail.
const sent: { to: string; text: string }[] = [];
vi.mock('../../services/comms/mailService.js', () => ({
  mailReachesPlayers: () => true,
  sendMail: (mail: { to: string; subject: string; text: string }) => {
    sent.push({ to: mail.to, text: mail.text });
    return Promise.resolve(true);
  },
}));

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
  app.use(createAuthRouter());

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

  // The repository game.json sets no `account`, so these are the defaults.
  it.each([
    ['a name that is too short', 'Al', 'secret123', /at least 3/],
    ['a name with a space', 'Sir Al', 'secret123', /characters/],
    ['a password that is too short', 'Newbie', 'short', /at least 8/],
  ])('refuses %s with a sentence to show', async (_, username, password, m) => {
    const res = await request(app)
      .post('/register')
      .send({ username, password });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(m);
  });

  it('refuses a name already taken in another case', async () => {
    await createPlayer('Admin', await hashPw('secret123'));

    const res = await request(app)
      .post('/register')
      .send({ username: 'admin', password: 'secret123' });

    expect(res.status).toBe(409);
  });

  it('lets one of two racing sign-ups in, whatever the case', async () => {
    await PlayerModel.init();
    const results = await Promise.all(
      ['CaseRace', 'caserace'].map((username) =>
        request(app)
          .post('/register')
          .send({ username, password: 'secret123' }),
      ),
    );

    expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(await PlayerModel.countDocuments({ name: /^caserace$/i })).toBe(1);
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

  it('refuses in the language the page asked in', async () => {
    const res = await request(app)
      .post('/login')
      .set('Accept-Language', 'pt')
      .send({ username: 'Ghost', password: 'whatever' });

    expect(res.body.message).toBe('Usuário ou senha inválidos');
  });

  it('rejects an invalid body with 400', async () => {
    const res = await request(app).post('/login').send({ username: 'x' });

    expect(res.status).toBe(400);
  });

  it('rejects a login for an account another instance is holding', async () => {
    await createPlayer('Alice', await hashPw('correcthorse'));
    presence.answer = { ok: false, owner: 'ws://beta:8080' };

    const res = await request(app)
      .post('/login')
      .send({ username: 'Alice', password: 'correcthorse' });

    presence.answer = { ok: true };
    expect(res.status).toBe(409);
    // The same sentence as a second window on this instance: which process
    // holds the account is not the player's business, and naming it would
    // publish the topology to anybody with a login form.
    expect(res.body.message).toMatch(/already logged in/);
    // Nothing about the world happened: the session was never written.
    expect(getPlayerByName('Alice')).toBeUndefined();
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

  // Default: the cookie dies with the browser. Closing the client should not
  // leave the next person at that machine holding the character.
  it('leaves the session cookie to the browser unless asked otherwise', async () => {
    await createPlayer('Ann', await hashPw('correcthorse'));

    const res = await request(app)
      .post('/login')
      .send({ username: 'Ann', password: 'correcthorse' });

    const cookie = String(res.headers['set-cookie']);
    expect(cookie).not.toMatch(/Expires=|Max-Age=/i);
  });

  it('keeps the session across a browser restart when remember is asked for', async () => {
    await createPlayer('Bea', await hashPw('correcthorse'));

    const res = await request(app)
      .post('/login')
      .send({ username: 'Bea', password: 'correcthorse', remember: true });

    expect(res.status).toBe(200);
    expect(String(res.headers['set-cookie'])).toMatch(/Expires=|Max-Age=/i);
  });

  // The flag is not a way in: it is read after the password, not instead of it.
  it('ignores remember on a failed login', async () => {
    await createPlayer('Cleo', await hashPw('correcthorse'));

    const res = await request(app)
      .post('/login')
      .send({ username: 'Cleo', password: 'wrong', remember: true });

    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
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

describe('the address a reset link goes to', () => {
  const loggedIn = async () => {
    await createPlayer('Alice', await hashPw('correcthorse'));
    const agent = request.agent(app);
    await agent
      .post('/login')
      .send({ username: 'Alice', password: 'correcthorse' });
    return agent;
  };

  beforeEach(() => {
    sent.length = 0;
  });

  it('is not settable from an open session alone', async () => {
    const agent = await loggedIn();

    const res = await agent
      .post('/email')
      .send({ currentPassword: 'guessing', email: 'thief@example.com' });

    expect(res.status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it('needs a session at all', async () => {
    await createPlayer('Alice', await hashPw('correcthorse'));

    const res = await request(app)
      .post('/email')
      .send({ currentPassword: 'correcthorse', email: 'alice@example.com' });

    expect(res.status).toBe(401);
  });

  it('counts from the moment the mailed link is opened', async () => {
    const agent = await loggedIn();

    const set = await agent
      .post('/email')
      .send({ currentPassword: 'correcthorse', email: 'alice@example.com' });
    expect(set.status).toBe(200);
    expect(sent[0]?.to).toBe('alice@example.com');
    // Not stored yet: the screen is told the mail went, not that it worked.
    expect((await agent.get('/email')).body.email).toBeNull();

    const link = /token=([^\s]+)/.exec(sent[0]!.text)?.[1] ?? '';
    const confirm = await request(app).get(`/email/confirm?token=${link}`);
    expect(confirm.status).toBe(200);

    expect((await agent.get('/email')).body.email).toBe('alice@example.com');
  });

  it('is where the reset link is then sent', async () => {
    const agent = await loggedIn();
    await agent
      .post('/email')
      .send({ currentPassword: 'correcthorse', email: 'alice@example.com' });
    const token = /token=([^\s]+)/.exec(sent[0]!.text)?.[1] ?? '';
    await request(app).get(`/email/confirm?token=${token}`);
    sent.length = 0;

    const res = await request(app)
      .post('/password/reset')
      .send({ username: 'Alice' });

    expect(res.status).toBe(200);
    expect(sent[0]?.to).toBe('alice@example.com');
    expect(sent[0]?.text).toContain('?reset=');
  });

  // Same answer for an account with an address and one without, so the reply
  // never says which accounts can be mailed.
  it('says nothing about an account with no address', async () => {
    await createPlayer('Bob', await hashPw('correcthorse'));

    const res = await request(app)
      .post('/password/reset')
      .send({ username: 'Bob' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(sent).toHaveLength(0);
  });
});

describe('POST /login with a second factor', () => {
  // Enrolling spends the code it was confirmed with, so the login uses the
  // next step, inside the drift window and not yet burned.
  async function enrolled(name: string, password: string) {
    await createPlayer(name, await hashPw(password));
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    await enableTwoFactor(name, secret, totpCode(secret));
    return () => totpCode(secret, Date.now() + 30_000);
  }

  it('refuses a password-only login and says what is missing', async () => {
    await enrolled('Guarded', 'pw');

    const res = await request(app)
      .post('/login')
      .send({ username: 'Guarded', password: 'pw' });

    expect(res.status).toBe(401);
    expect(res.body.twoFactorRequired).toBe(true);
    // Nothing about the world happened: no session, no player in the map.
    expect(getPlayerByName('Guarded')).toBeUndefined();
  });

  it('refuses a wrong code', async () => {
    await enrolled('Guarded', 'pw');

    const res = await request(app)
      .post('/login')
      .send({ username: 'Guarded', password: 'pw', totpToken: '000000' });

    expect(res.status).toBe(401);
    expect(res.body.twoFactorRequired).toBe(true);
  });

  it('lets the right code through, and into the world', async () => {
    const code = await enrolled('Guarded', 'pw');

    const res = await request(app)
      .post('/login')
      .send({ username: 'Guarded', password: 'pw', totpToken: code() });

    expect(res.status).toBe(200);
    expect(res.body.player.name).toBe('Guarded');
    expect(getPlayerByName('Guarded')).toBeDefined();
  });

  it('leaves an account with no enrollment alone', async () => {
    await createPlayer('Plain', await hashPw('pw'));

    const res = await request(app)
      .post('/login')
      .send({ username: 'Plain', password: 'pw' });

    expect(res.status).toBe(200);
  });
});

describe('authentication changing during login', () => {
  it.each(['demotion', 'password reset'])(
    'rejects a concurrent %s',
    async (change) => {
      await createPlayer('Racing', await hashPw('pw'));
      await setAccess('Racing', Access.ADMIN);
      const compare = vi
        .spyOn(bcrypt, 'compare')
        .mockImplementationOnce(async () => {
          await PlayerModel.updateOne(
            { name: 'Racing' },
            {
              $set:
                change === 'demotion'
                  ? { access: Access.USER }
                  : { password: await hashPw('new-pw') },
              $inc: { authEpoch: 1 },
            },
          );
          return true;
        });
      try {
        const response = await request(app)
          .post('/login')
          .send({ username: 'Racing', password: 'pw' });
        expect(response.status).toBe(401);
        expect(response.headers['set-cookie']).toBeUndefined();
      } finally {
        compare.mockRestore();
      }
    },
  );
});
