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

/**
 * Waits for the bus to have delivered, rather than for the clock.
 *
 * A fixed sleep here is a flaky test: the poll is every 500ms, but under a full
 * suite the machine decides when this process gets to run it.
 */
const until = async (done: () => boolean, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!done()) {
    if (Date.now() > deadline) throw new Error('bus delivered nothing in time');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

/**
 * Starts the bus and waits until it is actually delivering.
 *
 * Publishing straight after `startInstanceBus` races the query that takes the
 * position of the stream, and the loser is the event. Rather than guess how
 * long that takes on a loaded machine, this keeps offering a marker until
 * one comes back.
 */
const startAndSettle = async (): Promise<() => void> => {
  let ready = false;
  onInstanceEvent('ready?', () => {
    ready = true;
  });
  const stopBus = startInstanceBus();

  const deadline = Date.now() + 10_000;
  while (!ready) {
    if (Date.now() > deadline) throw new Error('bus never started delivering');
    await fromBeta('ready?', {});
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return stopBus;
};

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
    stop = await startAndSettle();

    // Own publish first, the other instance second: the bus reads in order, so
    // seeing the second one proves the first was reached and skipped.
    publishToInstances('chat', { line: 'from alpha' });
    await fromBeta('chat', { line: 'from beta' });
    await until(() => heard.length > 0);

    // Delivering its own publish back would double every global line it sends.
    expect(heard).toEqual([{ line: 'from beta' }]);
  }, 15_000);

  it('starts from now, rather than replaying what it missed', async () => {
    await fromBeta('chat', { line: 'said while this instance was down' });

    const heard: unknown[] = [];
    const marker: unknown[] = [];
    onInstanceEvent<{ line: string }>('chat', (payload) => heard.push(payload));
    onInstanceEvent<{ text: string }>('motd', (payload) =>
      marker.push(payload),
    );
    stop = await startAndSettle();

    // Something said after the boot: once that has arrived, whatever came
    // before it either arrived too or never will.
    await fromBeta('motd', { text: 'after the boot' });
    await until(() => marker.length > 0);

    expect(heard).toEqual([]);
  }, 15_000);

  it('keeps going past a handler that throws, and past a type it does not know', async () => {
    const heard: unknown[] = [];
    onInstanceEvent('chat', () => {
      throw new Error('handler is broken');
    });
    onInstanceEvent<{ text: string }>('motd', (payload) => heard.push(payload));
    stop = await startAndSettle();

    await fromBeta('chat', { line: 'boom' });
    await fromBeta('somethingFromANewerBuild', {});
    await fromBeta('motd', { text: 'still delivered' });
    await until(() => heard.length > 0);

    expect(heard).toEqual([{ text: 'still delivered' }]);
  }, 15_000);
});
