import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startMemoryMongo } from '../test/mongo.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { connectToDatabase, loadInitialData } from './initDb.js';
import GameMapModel from './model/Map.js';
import { runtimeState } from './sim/state.js';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await startMemoryMongo();
  (config as { mongoUri: string }).mongoUri = mongod.getUri();
  // Through the bare driver: once mongoose connects, the index it builds would
  // refuse the second name.
  const client = await mongoose.mongo.MongoClient.connect(mongod.getUri());
  await client
    .db(config.mongoDbName)
    .collection('players')
    .insertMany([{ name: 'Bob' }, { name: 'bob' }]);
  await client.close();
}, 30_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

it('says so when names differing only in case keep name_ci from building', async () => {
  const error = vi.spyOn(logger, 'error').mockImplementation(() => {});

  await connectToDatabase();

  expect(error).toHaveBeenCalledWith(
    expect.stringContaining('names differing only in case'),
    expect.anything(),
  );
});

it('refuses to boot a shard whose maps are not stored, rather than run them all', async () => {
  await GameMapModel.create([
    { id: '1', name: 'One', type: 'normal', tiles: [[{ tileIndex: 0 }]] },
    { id: '2', name: 'Two', type: 'normal', tiles: [[{ tileIndex: 0 }]] },
  ]);
  const instance = config.instance as { mapIds?: string[] };
  instance.mapIds = ['99'];
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  try {
    await expect(loadInitialData()).rejects.toThrow('MAP_IDS');
  } finally {
    instance.mapIds = undefined;
  }

  expect(Object.keys(runtimeState.maps)).toEqual([]);
  expect(await GameMapModel.countDocuments()).toBe(2);
});
