import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import { createConnection, type AddressInfo } from 'node:net';
import WebSocket from 'ws';
import fc from 'fast-check';
import { gameConfig } from '../gameConfig.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { createFixture, tile } from '../sim/simFixture.js';
import { Key, type Item } from '../../shared/types.js';
import { mapPixelHeight, mapPixelWidth } from '../../shared/mapGeometry.js';
import { ClientMessageSchema } from './clientMessage.js';
// Only the tracing half is pinned; everything else stays the real config, so
// the limits and payload sizes the other tests lean on are untouched.
const { tracing } = vi.hoisted(() => ({
  tracing: {
    endpoint: 'http://127.0.0.1:1/v1/traces',
    serviceName: 'test-engine',
    samplePercent: 100,
  },
}));

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config.js')>();
  return {
    ...actual,
    config: {
      ...actual.config,
      tracing,
      cors: { ...actual.config.cors, allowedOrigins: ['https://game.example'] },
    },
  };
});

import { playersWsMap } from './connections.js';
import {
  enqueueClientAction,
  getActionQueueSize,
  processActions,
  rateLimiterEntryCount,
  startWebSocketServer,
  stopWebSocketServer,
} from './transport.js';
import { pendingSpansForTest, resetTracingForTest } from '../tracing.js';
import mongoose from 'mongoose';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startMemoryMongo } from '../../test/mongo.js';
import { createPlayer } from '../services/player/playerService.js';
import { banPlayer } from '../services/player/banService.js';
import { getPlayerByName } from '../sim/world.js';
import { runtimeState } from '../sim/state.js';
import { playerRepository } from '../persistence/playerRepository.js';
import {
  refreshRegistry,
  registerInstance,
} from '../persistence/instanceRegistry.js';
import PlayerModel from '../model/Player.js';
import { pressedKeysMap } from '../services/world/movementService.js';

// An opening socket reads its player's document, so the database is real.
let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await startMemoryMongo();
  await mongoose.connect(mongod.getUri());
}, 30_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

// The queue is a module singleton, so every test drains it before asserting.
let fx: ReturnType<typeof createFixture>;

beforeEach(async () => {
  fx = createFixture();
  processActions();
  const cols = mongoose.connection.collections;
  await Promise.all(Object.values(cols).map((c) => c.deleteMany({})));
});

describe('processActions', () => {
  it('drains everything it was given', () => {
    const player = fx.addPlayer({ name: 'talker' });
    enqueueClientAction({
      username: 'talker',
      type: 'language',
      language: 'pt',
    });
    enqueueClientAction({
      username: 'talker',
      type: 'language',
      language: 'en',
    });
    expect(getActionQueueSize()).toBe(2);

    processActions();

    expect(getActionQueueSize()).toBe(0);
    expect(player.language).toBe('en');
  });

  // A client able to make a handler throw must not hold back what anyone
  // else sent behind it.
  it('carries on past an action whose handler throws', () => {
    const errorThrottled = vi
      .spyOn(logger, 'errorThrottled')
      .mockImplementation(() => {});
    const broken = fx.addPlayer({ name: 'broken' });
    Object.defineProperty(broken, 'language', {
      set() {
        throw new Error('boom');
      },
    });
    const talker = fx.addPlayer({ name: 'talker' });
    enqueueClientAction({
      username: 'broken',
      type: 'language',
      language: 'pt',
    });
    enqueueClientAction({
      username: 'talker',
      type: 'language',
      language: 'pt',
    });

    processActions();

    expect(talker.language).toBe('pt');
    expect(errorThrottled).toHaveBeenCalledWith(
      'action',
      '[ws] action failed',
      expect.objectContaining({ type: 'language', err: expect.any(Error) }),
    );
    errorThrottled.mockRestore();
  });

  it('has no rate-limiter entry without a connection', () => {
    expect(rateLimiterEntryCount()).toBe(0);
  });
});

describe('a keyboard release', () => {
  // Running is the held key, read every tick; the speed stat is what items and
  // levels gave the character, and a key coming up has no business with it.
  it('leaves the speed stat alone when Shift comes up', () => {
    const player = fx.addPlayer({ name: 'runner', speed: 7 });

    for (const type of ['press', 'release'] as const)
      enqueueClientAction({
        username: 'runner',
        type: 'keyboard',
        keyboardAction: { key: Key.Shift, type },
      });
    processActions();

    expect(player.speed).toBe(7);
  });
});

// What gets past the schema reaches a handler inside the tick. A throw there
// is contained and logged, but the action it came from is lost, so whatever
// the schema lets in has to be something the handlers survive, and leave the
// player in one piece after. The fixture's step turns a contained throw back
// into a failing test.
describe('processActions under any message the schema accepts', () => {
  const SWORD = 10;
  const HELMET = 11;
  const POTION = 12;
  const itemId = fc.oneof(fc.constantFrom(SWORD, HELMET, POTION), fc.nat());
  const message = fc.oneof(
    fc.record({
      type: fc.constant('keyboard'),
      keyboardAction: fc.record({
        key: fc.constantFrom(...Object.values(Key)),
        type: fc.constantFrom('press', 'release'),
      }),
      seq: fc.option(fc.integer(), { nil: undefined }),
    }),
    fc.record({
      type: fc.constant('item'),
      item: itemId,
      action: fc.constantFrom('use', 'drop'),
      quantity: fc.option(fc.integer({ min: 1 }), { nil: undefined }),
    }),
    fc.record({
      type: fc.constant('chat'),
      message: fc.oneof(
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.string({ maxLength: 40 }).map((rest) => `/${rest}`),
      ),
      scope: fc.constantFrom('player', 'map', 'global'),
    }),
    fc.record({
      type: fc.constant('custom'),
      channel: fc.string({ minLength: 1, maxLength: 64 }),
      payload: fc.option(fc.jsonValue(), { nil: undefined }),
    }),
    fc.record({
      type: fc.constant('language'),
      language: fc.string({ minLength: 2, maxLength: 8 }),
    }),
    fc.record({
      type: fc.constant('moveTo'),
      col: fc.integer({ min: 0, max: 4095 }),
      row: fc.integer({ min: 0, max: 4095 }),
    }),
  );

  it('handles it without throwing and conserves what the player carries', () => {
    fc.assert(
      fc.property(
        fc.array(message, { minLength: 1, maxLength: 12 }),
        fc.integer({ min: 1, max: 4 }),
        (messages, ticks) => {
          const sim = createFixture(0);
          sim.addItem({
            id: SWORD,
            name: 'Sword',
            sprite: 0,
            type: 'weapon',
          } as Item);
          sim.addItem({
            id: HELMET,
            name: 'Helm',
            sprite: 0,
            type: 'helmet',
          } as Item);
          sim.addItem({
            id: POTION,
            name: 'Potion',
            sprite: 0,
            type: 'consumable',
            effects: [{ attribute: 'health', type: 'add', value: 5 }],
          } as Item);
          const alice = sim.addPlayer({
            name: 'Alice',
            position: tile(3, 3),
            health: 50,
            inventory: {
              items: [
                { item: SWORD, quantity: 3 },
                { item: HELMET, quantity: 1 },
                { item: POTION, quantity: 5 },
              ],
              maxCapacity: 10,
            },
          });
          sim.addNpc({ position: tile(5, 3), behavior: 'neutral' });

          // As the socket handler does it: parsed, then queued under the name
          // the session carries.
          for (const raw of messages) {
            const parsed = ClientMessageSchema.safeParse(raw);
            expect(parsed.success).toBe(true);
            if (parsed.success) {
              enqueueClientAction({ username: 'Alice', ...parsed.data });
            }
          }
          sim.step(ticks);

          const held = (id: number) =>
            alice.inventory.items
              .filter((i) => i.item === id)
              .reduce((n, i) => n + i.quantity, 0) +
            Object.values(alice.equipped).filter((e) => e === id).length +
            sim.map.droppedItems
              .filter((d) => d.itemId === id)
              .reduce((n, d) => n + d.quantity, 0);
          expect(held(SWORD)).toBe(3);
          expect(held(HELMET)).toBe(1);
          expect(held(POTION)).toBeLessThanOrEqual(5);
          for (const { quantity } of alice.inventory.items) {
            expect(Number.isInteger(quantity) && quantity > 0).toBe(true);
          }
          expect(alice.health).toBeGreaterThanOrEqual(0);
          expect(alice.health).toBeLessThanOrEqual(alice.maxHealth);
          expect(alice.position.x).toBeGreaterThanOrEqual(0);
          expect(alice.position.y).toBeGreaterThanOrEqual(0);
          expect(alice.position.x + alice.width).toBeLessThanOrEqual(
            mapPixelWidth(sim.map.tiles),
          );
          expect(alice.position.y + alice.height).toBeLessThanOrEqual(
            mapPixelHeight(sim.map.tiles),
          );
        },
      ),
    );
  });
});

/**
 * The far end of a cross-instance warp, the one place two processes touch.
 * It is a socket, so the trace arrives on the query string (a browser cannot
 * set WebSocket headers), and this test proves the two halves join up.
 */
describe('the warp arrival', () => {
  let http: HttpServer;
  let port = 0;

  const asSession = (req: unknown, _res: unknown, next: () => void) => {
    (req as { session: { username: string } }).session = { username: 'Boss' };
    next();
  };

  const connect = (query: string) =>
    new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${query}`);
      ws.on('open', () => {
        ws.close();
        // The span is recorded during the upgrade, before this fires.
        resolve();
      });
      ws.on('error', reject);
    });

  beforeEach(async () => {
    resetTracingForTest();
    http = createServer();
    await new Promise<void>((resolve) => http.listen(0, resolve));
    port = (http.address() as AddressInfo).port;
    startWebSocketServer(http, asSession as never);
  });

  afterEach(async () => {
    await stopWebSocketServer();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });

  it('continues the trace the redirecting instance started', async () => {
    const traceId = 'c'.repeat(32);
    const spanId = 'd'.repeat(16);

    await connect(`?traceparent=00-${traceId}-${spanId}-01`);

    expect(pendingSpansForTest()).toEqual([
      { name: 'warp.arrive', traceId, parentSpanId: spanId },
    ]);
  });

  it('records nothing for an ordinary connection', async () => {
    await connect('');

    expect(pendingSpansForTest()).toEqual([]);
  });

  it('ignores a traceparent that is not one, rather than starting a trace', async () => {
    await connect('?traceparent=nonsense');

    expect(pendingSpansForTest()).toEqual([]);
  });
});

describe('the handshake origin', () => {
  let http: HttpServer;
  let port = 0;

  const asSession = (req: unknown, _res: unknown, next: () => void) => {
    (req as { session: { username: string } }).session = { username: 'Boss' };
    next();
  };

  const opens = (origin: string) =>
    new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin });
      ws.on('open', () => {
        ws.close();
        resolve(true);
      });
      ws.on('error', () => resolve(false));
    });

  beforeEach(async () => {
    http = createServer();
    await new Promise<void>((resolve) => http.listen(0, resolve));
    port = (http.address() as AddressInfo).port;
    startWebSocketServer(http, asSession as never);
  });

  afterEach(async () => {
    await stopWebSocketServer();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });

  it('lets in an origin CORS_ALLOWED_ORIGINS names', async () => {
    expect(await opens('https://game.example')).toBe(true);
  });

  it('lets in the page the server itself serves', async () => {
    expect(await opens(`http://127.0.0.1:${port}`)).toBe(true);
  });

  it('turns away any other page', async () => {
    expect(await opens('https://evil.game.example')).toBe(false);
  });

  it('drops a request line that is no URL and keeps serving', async () => {
    await new Promise<void>((resolve) => {
      const raw = createConnection(port, '127.0.0.1', () =>
        raw.write(
          'GET // HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\n' +
            'Connection: Upgrade\r\nSec-WebSocket-Version: 13\r\n' +
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n',
        ),
      );
      raw.on('close', () => resolve());
    });

    expect(await opens('https://game.example')).toBe(true);
  });
});

describe('stopping with a client that never answers the close', () => {
  let http: HttpServer;
  let port = 0;

  const asSession = (req: unknown, _res: unknown, next: () => void) => {
    (req as { session: { username: string } }).session = { username: 'Boss' };
    next();
  };

  beforeEach(async () => {
    await createPlayer('Boss', 'hash');
    playersWsMap.clear();
    http = createServer();
    await new Promise<void>((resolve) => http.listen(0, resolve));
    port = (http.address() as AddressInfo).port;
    startWebSocketServer(http, asSession as never);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => http.close(() => resolve()));
    playersWsMap.clear();
  });

  // A dropped wifi looks like this: the upgrade went through, then nothing
  // ever reads or answers again. The shutdown waiting on this writes the
  // players only after it, under its own forced-exit clock.
  it('returns within a few seconds rather than waiting out the peer', async () => {
    const raw = createConnection(port, '127.0.0.1', () =>
      raw.write(
        'GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\n' +
          'Connection: Upgrade\r\nSec-WebSocket-Version: 13\r\n' +
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n',
      ),
    );
    await new Promise<void>((resolve) => raw.once('data', () => resolve()));
    raw.pause();
    await new Promise((r) => setTimeout(r, 250));

    const outcome = await Promise.race([
      stopWebSocketServer().then(() => 'stopped'),
      new Promise((r) => setTimeout(() => r('still waiting'), 5_000)),
    ]);
    raw.destroy();

    expect(outcome).toBe('stopped');
  }, 10_000);
});

/**
 * The reconnect, which is the ordinary way a session continues: the client
 * dials again on its own after a blip, without logging in, so for a moment
 * the server holds both sockets under one name.
 */
describe('a replaced connection', () => {
  let http: HttpServer;
  let port = 0;

  let authEpoch = 0;
  const asSession = (req: unknown, _res: unknown, next: () => void) => {
    (req as { session: object }).session = { username: 'Boss', authEpoch };
    next();
  };

  const dialled: WebSocket[] = [];

  const open = () =>
    new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      dialled.push(ws);
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
    });

  const closed = (ws: WebSocket) =>
    new Promise<void>((resolve) => ws.on('close', () => resolve()));

  const settle = () => new Promise((r) => setTimeout(r, 250));

  beforeEach(async () => {
    await createPlayer('Boss', 'hash');
    authEpoch = (await playerRepository.authEpochOf('Boss'))!;
    playersWsMap.clear();
    http = createServer();
    await new Promise<void>((resolve) => http.listen(0, resolve));
    port = (http.address() as AddressInfo).port;
    startWebSocketServer(http, asSession as never);
  });

  afterEach(async () => {
    for (const ws of dialled.splice(0)) ws.terminate();
    await stopWebSocketServer();
    await new Promise<void>((resolve) => http.close(() => resolve()));
    playersWsMap.clear();
  });

  it('keeps the socket that took over when the old one finishes closing', async () => {
    const first = await open();
    const second = await open(); // the server closes `first` on this handshake

    await closed(first);
    await settle(); // the old socket's close handler runs on the server here

    const held = playersWsMap.get('Boss');
    expect(held).toBeDefined();
    expect(held?.readyState).toBe(WebSocket.OPEN);
    expect(second.readyState).toBe(WebSocket.OPEN);
  });

  it('drops the keys the old client was holding', async () => {
    await open();
    pressedKeysMap.set('Boss', new Set([Key.ArrowRight]));

    await open();
    await settle();

    // The new client sends what it holds itself; a key it never pressed
    // would walk the character with nobody at the keyboard.
    expect(pressedKeysMap.get('Boss')?.has(Key.ArrowRight)).toBeFalsy();
  });

  it('forgets the socket on an ordinary departure', async () => {
    const only = await open();

    only.close();
    await closed(only);
    await settle();

    expect(playersWsMap.has('Boss')).toBe(false);
  });
});

/**
 * The other half of the reconnect: the close landed and took the character
 * out of the world before the client dialled again. A warp to another
 * instance arrives the same way, with a session and a socket but no login.
 */
describe('a socket that comes back without a login', () => {
  let http: HttpServer;
  let port = 0;
  const startMapId = gameConfig.world.startMapId;

  let authEpoch = 0;
  const asSession = (req: unknown, _res: unknown, next: () => void) => {
    (req as { session: object }).session = { username: 'Boss', authEpoch };
    next();
  };

  const dialled: WebSocket[] = [];

  const open = () =>
    new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      dialled.push(ws);
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
    });

  const closed = (ws: WebSocket) =>
    new Promise<void>((resolve) => ws.on('close', () => resolve()));

  const settle = () => new Promise((r) => setTimeout(r, 250));

  beforeEach(async () => {
    runtimeState.maps[startMapId] = {
      id: startMapId,
      name: 'Start',
      type: 'normal',
      tiles: [],
      droppedItems: [],
      npcs: {},
      players: {},
    };
    await createPlayer('Boss', 'hash');
    authEpoch = (await playerRepository.authEpochOf('Boss'))!;
    playersWsMap.clear();
    http = createServer();
    await new Promise<void>((resolve) => http.listen(0, resolve));
    port = (http.address() as AddressInfo).port;
    startWebSocketServer(http, asSession as never);
  });

  afterEach(async () => {
    for (const ws of dialled.splice(0)) ws.terminate();
    await stopWebSocketServer();
    await new Promise<void>((resolve) => http.close(() => resolve()));
    playersWsMap.clear();
  });

  it('puts the character back on its map', async () => {
    await open();
    await settle();

    const boss = getPlayerByName('Boss');
    expect(boss).toBeDefined();
    expect(runtimeState.maps[startMapId]?.players[boss!.id]).toBe(boss);
  });

  it('closes the socket if account validation fails during resume', async () => {
    const query = vi
      .spyOn(playerRepository, 'authEpochOf')
      .mockRejectedValueOnce(new Error('database unavailable'));
    try {
      const ws = await open();
      await vi.waitFor(() => expect(ws.readyState).toBe(WebSocket.CLOSED));
      expect(playersWsMap.has('Boss')).toBe(false);
    } finally {
      query.mockRestore();
    }
  });

  it('keeps the socket when the heartbeat cannot reach the database', async () => {
    await stopWebSocketServer();
    await new Promise<void>((resolve) => http.close(() => resolve()));
    const interval = config.ws.heartbeatIntervalMs;
    (config.ws as { heartbeatIntervalMs: number }).heartbeatIntervalMs = 100;
    http = createServer();
    await new Promise<void>((resolve) => http.listen(0, resolve));
    port = (http.address() as AddressInfo).port;
    startWebSocketServer(http, asSession as never);
    const query = vi.spyOn(playerRepository, 'authEpochOf');
    try {
      const ws = await open();
      await settle();
      query.mockRejectedValue(new Error('database unavailable'));
      const checks = query.mock.calls.length;
      await vi.waitFor(() =>
        expect(query.mock.calls.length).toBeGreaterThan(checks + 1),
      );
      expect(ws.readyState).toBe(WebSocket.OPEN);
    } finally {
      query.mockRestore();
      (config.ws as { heartbeatIntervalMs: number }).heartbeatIntervalMs =
        interval;
    }
  });

  it('turns a banned account away rather than letting the socket back in', async () => {
    await banPlayer('Boss', 'botting');
    const ws = await open();
    const said = await new Promise<{ type: string; message: string }>(
      (resolve) =>
        ws.once('message', (data) =>
          resolve(
            JSON.parse((data as Buffer).toString()) as {
              type: string;
              message: string;
            },
          ),
        ),
    );
    await closed(ws);

    expect(said.type).toBe('kick');
    expect(said.message).toMatch(/banned/);
    expect(getPlayerByName('Boss')).toBeUndefined();
  });

  it('sends a character saved on a map another instance runs over there', async () => {
    await PlayerModel.updateOne({ name: 'Boss' }, { mapId: 'far' }).exec();
    await registerInstance('ws://far.example/ws', ['far']);
    await refreshRegistry();

    const ws = await open();
    const said = await new Promise<{ type: string; url: string }>((resolve) =>
      ws.once('message', (data) =>
        resolve(
          JSON.parse((data as Buffer).toString()) as {
            type: string;
            url: string;
          },
        ),
      ),
    );

    expect(said).toMatchObject({
      type: 'redirect',
      url: 'ws://far.example/ws',
    });
    expect(getPlayerByName('Boss')).toBeUndefined();
  });

  it('lets a key release past the message limit', async () => {
    const limits = config.limits as { wsMaxMessagesPerSecond: number };
    const limit = limits.wsMaxMessagesPerSecond;
    limits.wsMaxMessagesPerSecond = 3;
    try {
      const ws = await open();
      await settle();
      const key = (type: 'press' | 'release') =>
        JSON.stringify({
          type: 'keyboard',
          keyboardAction: { key: Key.ArrowRight, type },
        });

      ws.send(key('press'));
      for (let i = 0; i < 5; i++) ws.send('{}');
      ws.send(key('release'));
      await settle();
      processActions();

      expect(pressedKeysMap.get('Boss')?.has(Key.ArrowRight)).toBe(false);
    } finally {
      limits.wsMaxMessagesPerSecond = limit;
    }
  });

  it('leaves nobody behind when the socket drops while the character loads', async () => {
    const ws = await open();
    ws.terminate();
    await settle();

    expect(getPlayerByName('Boss')).toBeUndefined();
  });

  it('keeps the character when the redial lands right behind the close', async () => {
    const first = await open();
    await settle();

    first.close();
    await closed(first);
    await open(); // the close's write may still be in flight here
    await settle();

    expect(getPlayerByName('Boss')).toBeDefined();
  });
});

describe('revoking established sessions', () => {
  it('closes the old socket and discards its queued actions after password reset', async () => {
    const { default: bcrypt } = await import('bcrypt');
    const { default: request } = await import('supertest');
    const { default: session } = await import('express-session');
    const { createApp } = await import('../app.js');
    const { createSessionMiddleware } = await import('../http/session.js');
    const { createAuthRouter } = await import('../http/routes/authRoutes.js');
    const { createResetToken, consumeResetToken } =
      await import('../services/player/passwordService.js');
    await createPlayer('Online', await bcrypt.hash('old-password', 4));
    const app = createApp();
    const middleware = createSessionMiddleware(
      'test-secret',
      new session.MemoryStore(),
    );
    app.use(middleware);
    app.use(createAuthRouter());
    const login = await request(app)
      .post('/login')
      .send({ username: 'Online', password: 'old-password' });
    expect(login.status).toBe(200);
    const http = createServer(app);
    startWebSocketServer(http, middleware);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const port = (http.address() as AddressInfo).port;
    const cookie = String(login.headers['set-cookie']![0]).split(';')[0];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      headers: { Cookie: cookie! },
    });
    try {
      await new Promise<void>((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
      });
      ws.send(JSON.stringify({ type: 'language', language: 'pt' }));
      await vi.waitFor(() => expect(getActionQueueSize()).toBeGreaterThan(0));
      const token = await createResetToken('Online');
      expect(await consumeResetToken(token!.token, 'new-password')).toBe('ok');
      processActions();
      expect(getPlayerByName('Online')?.language).not.toBe('pt');
      await vi.waitFor(() => expect(ws.readyState).toBe(WebSocket.CLOSED));
    } finally {
      ws.terminate();
      await stopWebSocketServer();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    }
  });
});
