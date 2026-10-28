/**
 * KV store: in-memory semantics (sync) plus write-behind round-trip through
 * an in-memory MongoDB.
 */
import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from 'vitest';
import mongoose from 'mongoose';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startMemoryMongo } from '../../test/mongo.js';
import KvModel from '../model/Kv.js';
import {
  kvGet,
  kvSet,
  kvDelete,
  kvKeys,
  kvEntries,
  loadKvStore,
  flushKvStore,
  clearKvStoreMemory,
} from './kvStore.js';

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
  await KvModel.deleteMany({});
  clearKvStoreMemory();
});

describe('in-memory semantics', () => {
  it('set then get returns the value', () => {
    kvSet('global', 'motd', 'hello');
    expect(kvGet('global', 'motd')).toBe('hello');
  });

  it('get on a missing key/scope returns undefined', () => {
    expect(kvGet('nope', 'x')).toBeUndefined();
  });

  it('scopes are isolated', () => {
    kvSet('guild:a', 'leader', 'Alice');
    kvSet('guild:b', 'leader', 'Bob');
    expect(kvGet('guild:a', 'leader')).toBe('Alice');
    expect(kvGet('guild:b', 'leader')).toBe('Bob');
  });

  it('stores structured values', () => {
    kvSet('guild:dragons', 'members', ['Alice', 'Bob']);
    expect(kvGet<string[]>('guild:dragons', 'members')).toEqual([
      'Alice',
      'Bob',
    ]);
  });

  it('delete removes the key', () => {
    kvSet('global', 'flag', true);
    kvDelete('global', 'flag');
    expect(kvGet('global', 'flag')).toBeUndefined();
  });

  it('keys and entries list a scope', () => {
    kvSet('board', 'alice', 10);
    kvSet('board', 'bob', 20);
    expect(kvKeys('board').sort()).toEqual(['alice', 'bob']);
    expect(kvEntries('board').sort()).toEqual([
      ['alice', 10],
      ['bob', 20],
    ]);
  });
});

describe('write-behind persistence', () => {
  it('flush writes dirty entries to the DB', async () => {
    kvSet('global', 'count', 42);
    await flushKvStore();

    const doc = await KvModel.findOne({ scope: 'global', key: 'count' }).lean();
    expect(doc?.value).toBe(42);
  });

  it('load restores entries into memory', async () => {
    kvSet('guild:x', 'gold', 500);
    await flushKvStore();
    clearKvStoreMemory();
    expect(kvGet('guild:x', 'gold')).toBeUndefined();

    await loadKvStore();
    expect(kvGet('guild:x', 'gold')).toBe(500);
  });

  it('flush persists deletes', async () => {
    kvSet('global', 'temp', 1);
    await flushKvStore();
    kvDelete('global', 'temp');
    await flushKvStore();

    const doc = await KvModel.findOne({ scope: 'global', key: 'temp' }).lean();
    expect(doc).toBeNull();
  });

  it('overwriting a key upserts (no duplicate doc)', async () => {
    kvSet('global', 'v', 1);
    await flushKvStore();
    kvSet('global', 'v', 2);
    await flushKvStore();

    const docs = await KvModel.find({ scope: 'global', key: 'v' }).lean();
    expect(docs).toHaveLength(1);
    expect(docs[0]!.value).toBe(2);
  });

  it('flush with nothing dirty is a noop', async () => {
    await expect(flushKvStore()).resolves.toBeUndefined();
  });

  // A retry must not replay what failed regardless of what happened since: a
  // delete that failed while the key was set again, replayed after the new
  // value, would lose that value at the next restart.
  it.each([
    [
      'a value set after a failed delete',
      () => kvDelete('s', 'k'),
      () => kvSet('s', 'k', 'new'),
      'new',
    ],
    [
      'a delete after a failed write',
      () => kvSet('s', 'k', 'old'),
      () => kvDelete('s', 'k'),
      undefined,
    ],
  ] as const)('keeps %s', async (_, first, then, expected) => {
    kvSet('s', 'k', 'stored');
    await flushKvStore();
    first();

    const bulk = vi.spyOn(KvModel, 'bulkWrite').mockImplementationOnce(() => {
      then();
      return Promise.reject(new Error('connection reset'));
    });
    await flushKvStore();
    bulk.mockRestore();
    await flushKvStore();

    expect(kvGet('s', 'k')).toBe(expected);
    const doc = await KvModel.findOne({ scope: 's', key: 'k' }).lean<{
      value: unknown;
    }>();
    expect(doc?.value).toBe(expected);
  });

  it('lands a newer value after an older flush still out', async () => {
    kvSet('s', 'k', 'old');
    const write = KvModel.bulkWrite.bind(KvModel);
    let land = () => {};
    const bulk = vi
      .spyOn(KvModel, 'bulkWrite')
      .mockImplementationOnce(async (ops) => {
        await new Promise<void>((resolve) => (land = resolve));
        return write(ops);
      });

    const older = flushKvStore();
    await vi.waitFor(() => expect(bulk).toHaveBeenCalledOnce());
    kvSet('s', 'k', 'new');
    const newer = flushKvStore();
    await new Promise((resolve) => setTimeout(resolve, 50));
    land();
    await Promise.all([older, newer]);
    bulk.mockRestore();

    const doc = await KvModel.findOne({ scope: 's', key: 'k' }).lean<{
      value: unknown;
    }>();
    expect(doc?.value).toBe('new');
  });
});
