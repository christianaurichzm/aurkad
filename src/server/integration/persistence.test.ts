/**
 * Integration tests that require a real MongoDB connection.
 * Uses mongodb-memory-server, no external DB needed, no Docker.
 *
 * These cover only what unit/sim tests cannot: the round-trip through Mongoose
 * (schema transforms, minimize, $set partial updates) and the ban workflow.
 */
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startMemoryMongo } from '../../test/mongo.js';
import { playerRepository } from '../persistence/playerRepository.js';
import {
  createPlayer,
  persistPlayerSessionState,
  getPlayerByNameFromDb,
} from '../services/player/playerService.js';
import {
  banPlayer,
  getBan,
  unbanPlayer,
} from '../services/content/banService.js';

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
  const cols = mongoose.connection.collections;
  await Promise.all(Object.values(cols).map((c) => c.deleteMany({})));
});

// Player lifecycle

describe('player persistence', () => {
  it('newly created player loads from DB with equipped and inventory filled', async () => {
    await createPlayer('Alice', 'hash');

    const record = await playerRepository.findByName('Alice');

    expect(record).not.toBeNull();
    // Mongoose minimize drops `equipped: {}` so the repository must fill it back
    expect(record!.equipped).toEqual({});
    expect(record!.inventory).toMatchObject({
      items: [],
      maxCapacity: expect.any(Number),
    });
  });

  // Bootstrap admin is chosen by BOOTSTRAP_ADMIN_USERNAME when set, and only
  // falls back to "first registration wins" when it is not. The test has to
  // control that: config.ts loads .env.development under NODE_ENV=test too, so
  // a developer who sets the variable locally would otherwise see this fail.
  it('first registered player gets ADMIN access in non-production', async () => {
    const previous = process.env.BOOTSTRAP_ADMIN_USERNAME;
    delete process.env.BOOTSTRAP_ADMIN_USERNAME;
    try {
      const player = await createPlayer('FirstUser', 'hash');
      expect(player.access).toBeGreaterThan(0); // Access.USER = 0, ADMIN > 0
    } finally {
      if (previous === undefined) delete process.env.BOOTSTRAP_ADMIN_USERNAME;
      else process.env.BOOTSTRAP_ADMIN_USERNAME = previous;
    }
  });

  it('names the bootstrap admin when BOOTSTRAP_ADMIN_USERNAME is set', async () => {
    const previous = process.env.BOOTSTRAP_ADMIN_USERNAME;
    process.env.BOOTSTRAP_ADMIN_USERNAME = 'TheOperator';
    try {
      const chosen = await createPlayer('TheOperator', 'hash');
      const other = await createPlayer('SomeoneElse', 'hash');
      expect(chosen.access).toBeGreaterThan(0);
      expect(other.access).toBe(0);
    } finally {
      if (previous === undefined) delete process.env.BOOTSTRAP_ADMIN_USERNAME;
      else process.env.BOOTSTRAP_ADMIN_USERNAME = previous;
    }
  });

  it('subsequent players get USER access', async () => {
    await createPlayer('First', 'hash');
    const second = await createPlayer('Second', 'hash');
    expect(second.access).toBe(0); // Access.USER
  });

  it('persists mutated state and reloads it correctly', async () => {
    const player = await createPlayer('Alice', 'hash');

    // Simulate gameplay: player moves, picks up item, gains xp
    player.position = { x: 320, y: 192 };
    player.health = 72;
    player.experience = 45;
    player.inventory.items.push({ item: 5, quantity: 2 });

    await persistPlayerSessionState(player);

    const reloaded = await playerRepository.findByName('Alice');
    expect(reloaded!.position).toEqual({ x: 320, y: 192 });
    expect(reloaded!.health).toBe(72);
    expect(reloaded!.experience).toBe(45);
    expect(reloaded!.inventory.items).toContainEqual({ item: 5, quantity: 2 });
  });

  it('getPlayerByNameFromDb returns a complete record with normalized fields', async () => {
    await createPlayer('Alice', 'hash');

    const record = await getPlayerByNameFromDb('Alice');

    // This is what the login route uses; must never return undefined for equipped
    expect(record).not.toBeNull();
    expect(record!.equipped).toBeDefined();
    expect(record!.inventory).toBeDefined();
  });

  it('persists and reloads the custom data bag', async () => {
    const player = await createPlayer('Alice', 'hash');

    player.data = { vip: true, quest: { main: 3 } };
    await persistPlayerSessionState(player);

    const reloaded = await playerRepository.findByName('Alice');
    expect(reloaded!.data).toEqual({ vip: true, quest: { main: 3 } });
  });

  it('normalizes a missing data bag to an empty object', async () => {
    await createPlayer('Bob', 'hash');
    const record = await playerRepository.findByName('Bob');
    expect(record!.data).toEqual({});
  });
});

// Ban workflow

describe('ban workflow', () => {
  it('banned player has a ban record in the DB', async () => {
    await createPlayer('Alice', 'hash');
    await banPlayer('Alice', 'spamming', undefined);

    const ban = await getBan('Alice');

    expect(ban).not.toBeNull();
    expect(ban!.username).toBe('Alice');
    expect(ban!.reason).toBe('spamming');
  });

  it('ban with future expiry is still active', async () => {
    const until = Date.now() + 60_000;
    await banPlayer('Cheater', 'exploiting', until);

    const ban = await getBan('Cheater');

    expect(ban).not.toBeNull();
    expect(ban!.until).toBe(until);
    // login check: ban is active when Date.now() < until
    expect(Date.now()).toBeLessThan(ban!.until!);
  });

  it('ban with past expiry exists in DB but login route would clear it', async () => {
    const expired = Date.now() - 1000;
    await banPlayer('Old', 'test', expired);

    const ban = await getBan('Old');
    expect(ban).not.toBeNull();
    // The login route calls unbanPlayer when ban.until < Date.now()
    expect(Date.now()).toBeGreaterThan(ban!.until!);

    await unbanPlayer('Old');
    expect(await getBan('Old')).toBeNull();
  });

  it('unbanned player has no ban record', async () => {
    await banPlayer('Alice', 'reason', undefined);
    await unbanPlayer('Alice');

    expect(await getBan('Alice')).toBeNull();
  });
});
