import { describe, it, expect, afterEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { startMemoryMongo } from './mongo';

afterEach(() => vi.restoreAllMocks());

describe('startMemoryMongo', () => {
  it('retries a start that lost the race for a port', async () => {
    const create = vi
      .spyOn(MongoMemoryServer, 'create')
      .mockRejectedValueOnce(new Error('Port "27017" already in use'));

    const mongod = await startMemoryMongo();

    expect(create).toHaveBeenCalledTimes(2);
    expect(mongod.getUri()).toMatch(/^mongodb:\/\//);
    await mongod.stop();
  }, 30_000);

  it('gives up after the second failure instead of hiding a broken mongod', async () => {
    const create = vi
      .spyOn(MongoMemoryServer, 'create')
      .mockRejectedValue(new Error('no binary'));

    await expect(startMemoryMongo()).rejects.toThrow('no binary');
    expect(create).toHaveBeenCalledTimes(2);
  });
});
