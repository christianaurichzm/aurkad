import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startMemoryMongo } from '../../../test/mongo.js';
import PasswordResetModel from '../../model/PasswordReset.js';
import { createPlayer, getPlayerByNameFromDb } from './playerService.js';
import {
  changePassword,
  consumeResetToken,
  createResetToken,
  RESET_TOKEN_TTL_MS,
} from './passwordService.js';

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
  await createPlayer('Alice', await bcrypt.hash('old-password', 10));
});

const storedHash = async () =>
  (await getPlayerByNameFromDb('Alice'))?.password ?? '';

const canLogInWith = async (password: string) =>
  bcrypt.compare(password, await storedHash());

describe('changing a known password', () => {
  it('replaces the stored hash', async () => {
    expect(await changePassword('Alice', 'old-password', 'new-password')).toBe(
      'ok',
    );

    expect(await canLogInWith('new-password')).toBe(true);
    expect(await canLogInWith('old-password')).toBe(false);
  });

  it('refuses without the current one, and changes nothing', async () => {
    expect(await changePassword('Alice', 'guessing', 'new-password')).toBe(
      'wrong-password',
    );

    expect(await canLogInWith('old-password')).toBe(true);
  });

  it('reports an account that is not there', async () => {
    expect(await changePassword('Nobody', 'x', 'new-password')).toBe(
      'no-account',
    );
  });
});

describe('reset tokens', () => {
  it('mints one that sets a new password', async () => {
    const minted = await createResetToken('Alice');

    expect(minted?.username).toBe('Alice');
    expect(await consumeResetToken(minted!.token, 'new-password')).toBe('ok');
    expect(await canLogInWith('new-password')).toBe(true);
  });

  // The row holds a hash, so a readable database is no set of live links.
  it('never stores the token itself', async () => {
    const minted = await createResetToken('Alice');

    const rows = await PasswordResetModel.find().lean().exec();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toBe(minted!.token);
    expect(rows[0]!.tokenHash).toHaveLength(64);
  });

  it('spends once', async () => {
    const minted = await createResetToken('Alice');

    await consumeResetToken(minted!.token, 'first-password');

    expect(await consumeResetToken(minted!.token, 'second-password')).toBe(
      'invalid-token',
    );
    expect(await canLogInWith('first-password')).toBe(true);
  });

  // The sweeper runs on Mongo's schedule, so the read path cannot treat a row
  // that still exists as a token that still works.
  it('refuses one that is out of date even while its row survives', async () => {
    const minted = await createResetToken('Alice');
    await PasswordResetModel.updateOne(
      { username: 'Alice' },
      { expiresAt: new Date(Date.now() - RESET_TOKEN_TTL_MS) },
    ).exec();

    expect(await consumeResetToken(minted!.token, 'new-password')).toBe(
      'invalid-token',
    );
    expect(await canLogInWith('old-password')).toBe(true);
  });

  it('refuses a token nobody minted', async () => {
    expect(await consumeResetToken('made-up', 'new-password')).toBe(
      'invalid-token',
    );
  });

  // A link in flight is a way back into an account whose owner just moved it.
  it('drops every outstanding link when the password changes', async () => {
    const first = await createResetToken('Alice');
    const second = await createResetToken('Alice');

    await changePassword('Alice', 'old-password', 'new-password');

    expect(await PasswordResetModel.countDocuments()).toBe(0);
    expect(await consumeResetToken(first!.token, 'x-password')).toBe(
      'invalid-token',
    );
    expect(await consumeResetToken(second!.token, 'x-password')).toBe(
      'invalid-token',
    );
  });
});
