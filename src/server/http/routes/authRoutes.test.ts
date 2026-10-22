import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  onTestFinished,
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
import {
  authEpochOf,
  banAccount,
  createPlayer,
} from '../../services/player/playerService.js';
import { banPlayer, getBan } from '../../services/player/banService.js';
import { serverState } from '../../services/serverState.js';
import { playersWsMap } from '../../net/connections.js';
import { getPlayerByName } from '../../sim/world.js';
import { runtimeState } from '../../sim/state.js';
import { createFixture, makeTiles } from '../../sim/simFixture.js';
import { gameConfig } from '../../gameConfig.js';
import { config } from '../../config.js';
import GameMapModel from '../../model/Map.js';
import { Access } from '../../../shared/types.js';
import {
  enableTwoFactor,
  totpCode,
} from '../../services/player/twoFactorService.js';

// The other instance, which only exists as an answer here: whether a lease can
// be taken is decided in Mongo and tested in persistence/presence.test.ts, and
// what this file owns is what the route does with the answer.
// `taking` stands for whatever that instance writes on its way out, which can
// land between the reads this route makes and the lease it takes; `release`
// for a release whose write fails.
type PresenceAnswer = { ok: true } | { ok: false; owner: string };
const presence = vi.hoisted(
  (): {
    answer: PresenceAnswer;
    taking?: () => Promise<unknown>;
    release?: () => Promise<void>;
  } => ({
    answer: { ok: true },
  }),
);
vi.mock('../../persistence/presence.js', () => ({
  acquirePresence: async () => {
    await presence.taking?.();
    return presence.answer;
  },
  releasePresence: () => presence.release?.() ?? Promise.resolve(),
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
function authApp() {
  const built = express();
  built.use(express.json());
  built.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false },
    }),
  );
  built.use(createAuthRouter());
  return built;
}

/** The router behind a session store that refuses every write. */
function failingSessionApp() {
  const store = new session.MemoryStore();
  store.set = (_sid, _session, done) => done?.(new Error('store down'));
  const built = express();
  built.use(express.json());
  built.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
      store,
    }),
  );
  built.use(createAuthRouter());
  return built;
}

beforeEach(async () => {
  app = authApp();

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

  it('enters with what the instance letting go of the account wrote last', async () => {
    await createPlayer('Alice', await hashPw('correcthorse'));
    presence.taking = () =>
      PlayerModel.updateOne({ name: 'Alice' }, { $set: { experience: 25 } });
    try {
      const res = await request(app)
        .post('/login')
        .send({ username: 'Alice', password: 'correcthorse' });

      expect(res.status).toBe(200);
      expect(res.body.player.experience).toBe(25);
      expect(getPlayerByName('Alice')?.experience).toBe(25);
    } finally {
      presence.taking = undefined;
    }
  });

  it('leaves the character out of the world when the session cannot be saved', async () => {
    await createPlayer('Alice', await hashPw('correcthorse'));

    const res = await request(failingSessionApp())
      .post('/login')
      .send({ username: 'Alice', password: 'correcthorse' });

    expect(res.status).toBe(500);
    expect(getPlayerByName('Alice')).toBeUndefined();
  });

  // The database that refused the session is likely to refuse the release
  // too, and a rejection nobody handles ends the process (server.ts).
  it('keeps the server up when the lease cannot be let go either', async () => {
    await createPlayer('Alice', await hashPw('correcthorse'));
    const loose: unknown[] = [];
    const onLoose = (reason: unknown) => loose.push(reason);
    process.on('unhandledRejection', onLoose);
    presence.release = () => Promise.reject(new Error('database down'));
    onTestFinished(() => {
      process.off('unhandledRejection', onLoose);
      presence.release = undefined;
    });

    const res = await request(failingSessionApp())
      .post('/login')
      .send({ username: 'Alice', password: 'correcthorse' });
    await new Promise((resolve) => setImmediate(resolve));

    expect(res.status).toBe(500);
    expect(loose).toEqual([]);
  });

  // The client opens the socket that redirects it only once it has a map to
  // open the game on.
  it('answers with the map another instance runs when the character is on it', async () => {
    await createPlayer('Alice', await hashPw('correcthorse'));
    await PlayerModel.updateOne({ name: 'Alice' }, { mapId: 'away' });
    await GameMapModel.create({
      id: 'away',
      name: 'Away',
      type: 'normal',
      tiles: makeTiles(6, 4),
    });
    const instance = config.instance as { mapIds?: string[] };
    instance.mapIds = [gameConfig.world.startMapId];
    try {
      const res = await request(app)
        .post('/login')
        .send({ username: 'Alice', password: 'correcthorse' });

      expect(res.status).toBe(200);
      expect(res.body.map).toMatchObject({ id: 'away', name: 'Away' });
    } finally {
      instance.mapIds = undefined;
    }
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

  // A cookie planted in the victim's browser (a sibling subdomain, plain http)
  // is the attacker's own session; logging in on it would hand them the account.
  it('signs in on a new session, so a cookie planted before it names nobody', async () => {
    await createPlayer('Mallory', await hashPw('correcthorse'));
    await createPlayer('Vic', await hashPw('batterystaple'));
    const planted = String(
      (
        await request(app)
          .post('/login')
          .send({ username: 'Mallory', password: 'correcthorse' })
      ).headers['set-cookie'],
    ).split(';')[0]!;

    const res = await request(app)
      .post('/login')
      .set('Cookie', planted)
      .send({ username: 'Vic', password: 'batterystaple' });
    expect(res.status).toBe(200);
    const own = String(res.headers['set-cookie']).split(';')[0]!;

    expect(own).not.toBe(planted);
    expect(
      (await request(app).get('/email').set('Cookie', planted)).status,
    ).toBe(401);
    expect((await request(app).get('/email').set('Cookie', own)).status).toBe(
      200,
    );
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

  it('refuses an account banned under another spelling of its name', async () => {
    await createPlayer('Banned', await hashPw('pw'));
    const before = (await authEpochOf('Banned'))!;

    expect(await banAccount('banned', 'spamming')).toBe('Banned');

    const res = await request(app)
      .post('/login')
      .send({ username: 'Banned', password: 'pw' });
    expect(res.status).toBe(403);
    // The generation moved on, which is what ends a session opened before.
    expect(await authEpochOf('Banned')).toBe(before + 1);
  });

  it('bans nobody under a name no account has', async () => {
    expect(await banAccount('Ghost')).toBeNull();
    expect(await getBan('Ghost')).toBeNull();
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

  it('closes the game socket, so the next login is let in', async () => {
    await createPlayer('Alice', await hashPw('correcthorse'));
    const agent = request.agent(app);
    const login = () =>
      agent
        .post('/login')
        .send({ username: 'Alice', password: 'correcthorse' });
    expect((await login()).status).toBe(200);
    const socket = {
      readyState: WebSocket.OPEN as number,
      close: vi.fn(() => {
        socket.readyState = WebSocket.CLOSING;
      }),
    };
    playersWsMap.set('Alice', socket as unknown as WebSocket);

    expect((await agent.post('/logout')).status).toBe(200);

    expect(socket.close).toHaveBeenCalled();
    await vi.waitFor(() => expect(getPlayerByName('Alice')).toBeUndefined());
    expect((await login()).status).toBe(200);
  });
});

describe('POST /password', () => {
  it('lets an open session guess the current password only as often as a login', async () => {
    // Pinned: a local .env can raise the login limit out of the way.
    const limits = config.auth as { rateLimitMax: number };
    const was = limits.rateLimitMax;
    limits.rateLimitMax = 3;
    onTestFinished(() => {
      limits.rateLimitMax = was;
    });
    const agent = request.agent(authApp());
    await createPlayer('Alice', await hashPw('correcthorse'));
    await agent
      .post('/login')
      .send({ username: 'Alice', password: 'correcthorse' });

    const guess = () =>
      agent
        .post('/password')
        .send({ currentPassword: 'guessing', newPassword: 'batterystaple' });
    for (let i = 0; i < 3; i++) {
      expect((await guess()).status).toBe(403);
    }
    expect((await guess()).status).toBe(429);
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
