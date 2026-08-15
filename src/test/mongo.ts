/**
 * In-memory MongoDB for the DB-backed test files, with a retry. Vitest
 * runs a dozen files in parallel, each starting its own mongod, and
 * `getFreePort` can hand two workers the same port (it closes its probe
 * before mongod binds, and its cache is per process). The loser throws out
 * of `beforeAll` and silently skips its file; a slow start past the 10s
 * launch timeout ends the same way.
 *
 * One retry, as every attempt picks a new port: a lost race succeeds the
 * second time, a broken mongod fails twice, and two attempts fit inside
 * the 30s hook budget.
 */
import { MongoMemoryServer, MongoMemoryReplSet } from 'mongodb-memory-server';

async function retryOnce<T>(start: () => Promise<T>): Promise<T> {
  try {
    return await start();
  } catch {
    return await start();
  }
}

export function startMemoryMongo(): Promise<MongoMemoryServer> {
  return retryOnce(() => MongoMemoryServer.create());
}

export function startMemoryReplSet(): Promise<MongoMemoryReplSet> {
  return retryOnce(() => MongoMemoryReplSet.create({ replSet: { count: 1 } }));
}
