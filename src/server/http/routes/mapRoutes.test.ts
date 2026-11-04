import express, { type NextFunction, type Response } from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { ExtendedRequest } from '../session.js';
import { Access } from '../../../shared/types.js';
import { startMemoryMongo } from '../../../test/mongo.js';

// checkAccess pulls in the audit trail, which has its own tests.
vi.mock('../../services/auditService.js', () => ({
  recordAdminAction: vi.fn(),
  summarizeDetails: () => undefined,
}));

import { createApp, handleRouteError } from '../../app.js';
import { createMapRouter } from './mapRoutes.js';
import GameMapModel from '../../model/Map.js';
import { runtimeState } from '../../sim/state.js';
import { createFixture } from '../../sim/simFixture.js';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await startMemoryMongo();
  await mongoose.connect(mongod.getUri());
}, 30_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await GameMapModel.deleteMany({});
});

const app = () => {
  const app = express();
  app.use((req: ExtendedRequest, _res: Response, next: NextFunction) => {
    req.session = {
      username: 'op',
      accessLevel: Access.ADMIN,
    } as ExtendedRequest['session'];
    next();
  });
  app.use(express.json());
  app.use(createMapRouter());
  return app;
};

/** The fixture's map, stored the way a saved map is. */
const storedMap = async () => {
  const sim = createFixture();
  await GameMapModel.create({
    id: sim.mapId,
    name: sim.map.name,
    type: sim.map.type,
    tiles: sim.map.tiles,
  });
  return sim;
};

describe('PUT /maps/:id', () => {
  it('refuses a map that does not exist instead of making one', async () => {
    createFixture();

    const res = await request(app()).put('/maps/missing').send({ name: 'X' });

    expect(res.status).toBe(404);
    expect(runtimeState.maps['missing']).toBeUndefined();
    expect(await GameMapModel.exists({ id: 'missing' })).toBeNull();
  });

  it('renames a map that does', async () => {
    const sim = await storedMap();

    const res = await request(app())
      .put(`/maps/${sim.mapId}`)
      .send({ name: 'Renamed' });

    expect(res.status).toBe(200);
    expect(runtimeState.maps[sim.mapId]?.name).toBe('Renamed');
  });

  // Combat reads the live map, and the client shows the zone from the meta it
  // was sent, which only goes out again for a new revision.
  it('makes a map safe for everyone already on it', async () => {
    const sim = await storedMap();
    const revision = sim.map.tilesRevision ?? 0;

    const res = await request(app())
      .put(`/maps/${sim.mapId}`)
      .send({ pvp: 'safe' });

    expect(res.status).toBe(200);
    const live = runtimeState.maps[sim.mapId];
    expect(live?.pvp).toBe('safe');
    expect(live?.tilesRevision).toBe(revision + 1);
    expect((await GameMapModel.findOne({ id: sim.mapId }).lean())?.pvp).toBe(
      'safe',
    );
  });

  it('stops the music for everyone already on the map when it is cleared', async () => {
    const sim = await storedMap();
    sim.map.music = 'theme.mp3';
    const revision = sim.map.tilesRevision ?? 0;

    await request(app()).put(`/maps/${sim.mapId}`).send({ music: '' });

    const live = runtimeState.maps[sim.mapId];
    expect(live?.music).toBe('');
    expect(live?.tilesRevision).toBe(revision + 1);
  });
});

describe('POST /maps/:id/resize', () => {
  it('fails, rather than reporting a resize nobody applied, for a map this instance does not run', async () => {
    const sim = await storedMap();
    await GameMapModel.create({
      id: 'elsewhere',
      name: 'Far',
      type: 'normal',
      tiles: sim.map.tiles,
    });

    const res = await request(app())
      .post('/maps/elsewhere/resize')
      .send({ cols: 3, rows: 3 });

    expect(res.status).toBe(500);
    const stored = await GameMapModel.findOne({ id: 'elsewhere' }).lean();
    expect(stored?.tiles).toHaveLength(sim.map.tiles.length);
  });
});

describe('POST /saveMap', () => {
  // With the parsers the server mounts: app.ts's 1 MB one ahead of the route's.
  const serverApp = (accessLevel: Access) => {
    const app = createApp();
    app.use((req: ExtendedRequest, _res: Response, next: NextFunction) => {
      req.session = {
        username: 'op',
        accessLevel,
      } as ExtendedRequest['session'];
      next();
    });
    app.use(createMapRouter());
    app.use(handleRouteError);
    return app;
  };

  const grid = (cols: number, rows: number) =>
    Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => ({
        tileIndex: 1234,
        blocked: true,
        fringeIndex: 321,
        maskIndex: 45,
      })),
    );

  const save = (
    sim: Awaited<ReturnType<typeof storedMap>>,
    tiles: unknown,
    access = Access.ADMIN,
  ) =>
    request(serverApp(access)).post('/saveMap').send({
      mapId: sim.mapId,
      name: sim.map.name,
      type: sim.map.type,
      tiles,
    });

  it('saves a grid painted on every layer at the largest size a map can have', async () => {
    const sim = await storedMap();

    const res = await save(sim, grid(200, 200));

    expect(res.status).toBe(200);
    const stored = await GameMapModel.findOne({ id: sim.mapId }).lean();
    expect(stored?.tiles).toHaveLength(200);
    expect(stored?.tiles[199]).toHaveLength(200);
  });

  it.each([
    ['no rows', []],
    ['an empty row', [[]]],
    ['too many rows', grid(1, 201)],
    ['too many columns', grid(201, 1)],
  ])('refuses a grid with %s', async (_, tiles) => {
    const sim = await storedMap();

    const res = await save(sim, tiles);

    expect(res.status).toBe(400);
    const stored = await GameMapModel.findOne({ id: sim.mapId }).lean();
    expect(stored?.tiles).toHaveLength(sim.map.tiles.length);
  });

  // The pk module flags a kill only where the morale is `normal`, which the
  // map editor sets alongside the grid.
  it('saves the morale it is sent, for everyone already on the map', async () => {
    const sim = await storedMap();
    const revision = sim.map.tilesRevision ?? 0;

    const res = await request(serverApp(Access.ADMIN)).post('/saveMap').send({
      mapId: sim.mapId,
      name: sim.map.name,
      type: 'pvp',
      pvp: 'normal',
      tiles: sim.map.tiles,
    });

    expect(res.status).toBe(200);
    const live = runtimeState.maps[sim.mapId];
    expect(live?.pvp).toBe('normal');
    expect(live?.tilesRevision).toBe(revision + 1);
    const stored = await GameMapModel.findOne({ id: sim.mapId }).lean();
    expect(stored?.pvp).toBe('normal');
    const loaded = await request(app()).get(`/maps/${sim.mapId}`);
    expect(loaded.body.pvp).toBe('normal');
  });

  it('keeps the morale when a save leaves it out', async () => {
    const sim = await storedMap();
    sim.map.pvp = 'normal';

    const res = await save(sim, sim.map.tiles);

    expect(res.status).toBe(200);
    expect(runtimeState.maps[sim.mapId]?.pvp).toBe('normal');
  });

  it('reads no grid for an account that may not save one', async () => {
    const sim = await storedMap();

    const res = await save(sim, grid(200, 200), Access.MOD);

    expect(res.status).toBe(403);
  });
});
