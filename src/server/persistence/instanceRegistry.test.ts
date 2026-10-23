import { afterAll, beforeAll, afterEach, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startMemoryMongo } from '../../test/mongo.js';
import { config } from '../config.js';
import {
  claimMaps,
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

it('refuses to boot on a map a live instance serves, and leaves no entry', async () => {
  await registerInstance('ws://c', ['10', '11']);

  await expect(claimMaps('ws://d', ['11', '12'])).rejects.toThrow(
    'ws://c (11)',
  );
  await refreshRegistry();
  expect(lookupInstanceUrl('11')).toBe('ws://c');
  expect(lookupInstanceUrl('12')).toBeUndefined();
});

it('takes over the maps of an instance whose claim has lapsed', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  await registerInstance('ws://e', ['20']);
  vi.setSystemTime(Date.now() + 3 * defaultBeat + 1);

  await claimMaps('ws://f', ['20']);
  await refreshRegistry();
  expect(lookupInstanceUrl('20')).toBe('ws://f');
});
