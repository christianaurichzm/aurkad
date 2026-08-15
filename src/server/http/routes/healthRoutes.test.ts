import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  vi,
} from 'vitest';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startMemoryMongo } from '../../../test/mongo.js';
import { createHealthRouter } from './healthRoutes.js';
import { recordTick, resetMetricsForTest } from '../../metrics.js';

let mongod: MongoMemoryServer | undefined;
let app: express.Express;

beforeAll(() => {
  resetMetricsForTest();
  app = express();
  app.use(createHealthRouter());
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  if (mongoose.connection.readyState === mongoose.ConnectionStates.connected)
    await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

describe('healthRoutes', () => {
  it('GET /healthz is liveness-only and always 200', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptime).toBe('number');
  });

  it('GET /readyz returns 503 while the DB is not connected', async () => {
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(503);
    expect(res.body.db).toBe(false);
  });

  // 30s like the beforeAll of every other DB test file: this is the one that
  // starts mongod inside the test, so the 15s testTimeout would cut a retry.
  it('GET /readyz returns 200 once the DB is connected and the loop is ticking', async () => {
    mongod = await startMemoryMongo();
    await mongoose.connect(mongod.getUri());
    recordTick(1, 0); // stand in for a fresh simulation tick
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body.db).toBe(true);
    expect(res.body.loop).toBe(true);
  }, 30_000);

  // The point of readiness over liveness: a process whose DB is fine but whose
  // simulation loop has stalled must stop taking traffic.
  it('GET /readyz returns 503 when the loop stalls even with the DB up', async () => {
    recordTick(1, 0);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 10_000); // past TICK_STALENESS_MS

    const res = await request(app).get('/readyz');
    expect(res.status).toBe(503);
    expect(res.body.db).toBe(true);
    expect(res.body.loop).toBe(false);
  });
});
