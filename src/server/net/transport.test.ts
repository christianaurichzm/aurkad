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
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { ServerActionType } from '../engine/actions.js';
import { gameConfig } from '../gameConfig.js';
import { advanceTick } from '../sim/clock.js';
import { createFixture, tile } from '../sim/simFixture.js';
import { rebuildQuadtree } from '../spatial/spatialManager.js';
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
  enqueueServerAction,
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
import { banPlayer } from '../services/content/banService.js';
import { getPlayerByName } from '../sim/world.js';
import { runtimeState } from '../sim/state.js';

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
    enqueueServerAction(ServerActionType.RegeneratePlayersHP);
    enqueueServerAction(ServerActionType.UpdateNpcPositions);
    expect(getActionQueueSize()).toBe(2);

    processActions();

    expect(getActionQueueSize()).toBe(0);
  });

  it('has no rate-limiter entry without a connection', () => {
    expect(rateLimiterEntryCount()).toBe(0);
  });
});

describe('RegeneratePlayersHP', () => {
  it('heals a hurt player by the configured share of its pool', () => {
    const { regenPercent, minRegen } = gameConfig.combat;
    const player = fx.addPlayer({ maxHealth: 1000, health: 500 });
    const expected = Math.max(Math.floor(1000 * regenPercent), minRegen);

    enqueueServerAction(ServerActionType.RegeneratePlayersHP);
    processActions();

    expect(player.health).toBe(500 + expected);
  });

  it('never heals past the pool, and leaves a full player alone', () => {
    const full = fx.addPlayer({ maxHealth: 100, health: 100 });
    const nearlyFull = fx.addPlayer({ maxHealth: 100, health: 99 });

    enqueueServerAction(ServerActionType.RegeneratePlayersHP);
    processActions();

    expect(full.health).toBe(100);
    expect(nearlyFull.health).toBe(100);
  });
});

describe('UpdateNpcPositions', () => {
  it('walks an npc whose interval is due on this tick', () => {
    fx.addPlayer({ name: 'bait', position: tile(3, 3) });
    const npc = fx.addNpc({
      behavior: 'aggressive',
      position: tile(6, 3),
      moveIntervalMs: 1,
      sight: 10,
    });
    const before = { ...npc.position };

    rebuildQuadtree(fx.map.id, fx.map); // the sight query reads the index
    enqueueServerAction(ServerActionType.UpdateNpcPositions);
    processActions();

    expect(npc.position).not.toEqual(before);
  });

  it('skips an npc whose interval has not come round yet', () => {
    fx.addPlayer({ name: 'bait', position: tile(3, 3) });
    const npc = fx.addNpc({
      behavior: 'aggressive',
      position: tile(6, 3),
      moveIntervalMs: 60_000, // 1200 ticks, so tick 1 is not a multiple
      sight: 10,
    });
    const before = { ...npc.position };

    advanceTick(); // not fx.step: the fixture drives updateNpcs itself
    rebuildQuadtree(fx.map.id, fx.map);
    enqueueServerAction(ServerActionType.UpdateNpcPositions);
    processActions();

    expect(npc.position).toEqual(before);
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
});

/**
 * The reconnect, which is the ordinary way a session continues: the client
 * dials again on its own after a blip, without logging in, so for a moment
 * the server holds both sockets under one name.
 */
describe('a replaced connection', () => {
  let http: HttpServer;
  let port = 0;

  const asSession = (req: unknown, _res: unknown, next: () => void) => {
    (req as { session: { username: string } }).session = { username: 'Boss' };
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

  const asSession = (req: unknown, _res: unknown, next: () => void) => {
    (req as { session: { username: string } }).session = { username: 'Boss' };
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
