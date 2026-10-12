import { afterAll, beforeAll, afterEach, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startMemoryMongo } from '../../test/mongo.js';
import { config } from '../config.js';
import {
  lookupInstanceUrl,
  refreshRegistry,
  registerInstance,
} from './instanceRegistry.js';

let mongod: MongoMemoryServer;
const instance = config.instance as { heartbeatMs: number };
const defaultBeat = instance.heartbeatMs;

beforeAll(async () => {
  mongod = await startMemoryMongo();
  await mongoose.connect(mongod.getUri());
}, 30_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(() => {
  vi.useRealTimers();
  instance.heartbeatMs = defaultBeat;
});

it('keeps an instance on the slowest accepted heartbeat between its beats', async () => {
  instance.heartbeatMs = 300_000;
  vi.useFakeTimers({ toFake: ['Date'] });
  await registerInstance('ws://a', ['1']);

  vi.setSystemTime(Date.now() + 2 * 300_000);
  await refreshRegistry();
  expect(lookupInstanceUrl('1')).toBe('ws://a');

  vi.setSystemTime(Date.now() + 2 * 300_000);
  await refreshRegistry();
  expect(lookupInstanceUrl('1')).toBeUndefined();
});
