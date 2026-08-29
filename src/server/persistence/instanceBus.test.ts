import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import mongoose from 'mongoose';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startMemoryMongo } from '../../test/mongo.js';

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config.js')>();
  return {
    ...actual,
    config: {
      ...actual.config,
      instance: { ...actual.config.instance, wsPublicUrl: 'ws://alpha:8080' },
    },
  };
});

const { onInstanceEvent, publishToInstances, startInstanceBus } =
  await import('./instanceBus.js');

let mongod: MongoMemoryServer;
let stop: () => void;

// The bus polls twice a second; a wait of two intervals is one poll that had
// to see the write, whatever the machine was doing during the first.
const pollTwice = () => new Promise((resolve) => setTimeout(resolve, 1_100));

/** What the other instance looks like from here: a row it wrote. */
const fromBeta = async (type: string, payload: unknown) => {
  await mongoose.connection
    .collection('instanceevents')
    .insertOne({ from: 'ws://beta:8080', type, payload, at: new Date() });
};

beforeAll(async () => {
  mongod = await startMemoryMongo();
  await mongoose.connect(mongod.getUri());
}, 30_000);

afterAll(async () => {
  stop?.();
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(() => {
  stop?.();
});

describe('what one instance tells the others', () => {
  it('delivers what another instance said, and not its own echo', async () => {
    const heard: unknown[] = [];
    onInstanceEvent<{ line: string }>('chat', (payload) => heard.push(payload));
    stop = startInstanceBus();
    await pollTwice();

    await fromBeta('chat', { line: 'from beta' });
    publishToInstances('chat', { line: 'from alpha' });
    await pollTwice();

    // Both rows are on the bus; only one of them is news. Delivering its own
    // publish back would double every global line the instance sends.
    expect(heard).toEqual([{ line: 'from beta' }]);
  }, 15_000);

  it('starts from now, rather than replaying what it missed', async () => {
    await fromBeta('chat', { line: 'said while this instance was down' });

    const heard: unknown[] = [];
    onInstanceEvent<{ line: string }>('chat', (payload) => heard.push(payload));
    stop = startInstanceBus();
    await pollTwice();
    await pollTwice();

    expect(heard).toEqual([]);
  }, 15_000);

  it('keeps going past a handler that throws, and past a type it does not know', async () => {
    const heard: unknown[] = [];
    onInstanceEvent('chat', () => {
      throw new Error('handler is broken');
    });
    onInstanceEvent<{ text: string }>('motd', (payload) => heard.push(payload));
    stop = startInstanceBus();
    await pollTwice();

    await fromBeta('chat', { line: 'boom' });
    await fromBeta('somethingFromANewerBuild', {});
    await fromBeta('motd', { text: 'still delivered' });
    await pollTwice();

    expect(heard).toEqual([{ text: 'still delivered' }]);
  }, 15_000);
});
