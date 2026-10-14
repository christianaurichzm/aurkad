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
});
