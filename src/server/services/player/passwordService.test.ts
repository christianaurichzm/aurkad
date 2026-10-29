import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  onTestFinished,
  vi,
} from 'vitest';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startMemoryMongo } from '../../../test/mongo.js';
import PasswordResetModel from '../../model/PasswordReset.js';
import { playerRepository } from '../../persistence/playerRepository.js';
import {
  authEpochOf,
  createPlayer,
  deletePlayer,
  enterWorld,
  getPlayerByName,
  getPlayerByNameFromDb,
  persistPlayerSessionState,
} from './playerService.js';
import { createFixture } from '../../sim/simFixture.js';
import {
  changePassword,
  confirmEmailToken,
  consumeResetToken,
  createEmailToken,
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

/** The generation a password check reads before an address link is minted. */
const epoch = async () => (await authEpochOf('Alice'))!;

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

  it('does not undo a reset that lands after the old password was checked', async () => {
    const minted = await createResetToken('Alice');
    const compare = bcrypt.compare.bind(bcrypt) as (
      data: string,
      hash: string,
    ) => Promise<boolean>;
    vi.spyOn(bcrypt, 'compare').mockImplementationOnce((async (
      data: string,
      hash: string,
    ) => {
      const matched = await compare(data, hash);
      await consumeResetToken(minted!.token, 'recovered');
      return matched;
    }) as never);

    expect(await changePassword('Alice', 'old-password', 'stale')).toBe(
      'wrong-password',
    );
    expect(await canLogInWith('recovered')).toBe(true);
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

  // Sequentially the second attempt finds the row gone. Both of these find it
  // there, which is what a link that leaked and is being raced looks like: the
  // loser must not get to choose the password the account keeps.
  it('spends once even when spent twice at the same time', async () => {
    const minted = await createResetToken('Alice');

    const results = await Promise.all([
      consumeResetToken(minted!.token, 'first-password'),
      consumeResetToken(minted!.token, 'second-password'),
    ]);

    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    const winner = results[0] === 'ok' ? 'first-password' : 'second-password';
    expect(await canLogInWith(winner)).toBe(true);
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

  // The hash is slow enough for the owner's change to land while a link that
  // was spent before it is still on its way to the write.
  it('does not undo a change that lands while a link is being spent', async () => {
    const minted = await createResetToken('Alice');
    const hash = bcrypt.hash.bind(bcrypt) as (
      data: string,
      rounds: number,
    ) => Promise<string>;
    vi.spyOn(bcrypt, 'hash').mockImplementationOnce((async (
      data: string,
      rounds: number,
    ) => {
      await changePassword('Alice', 'old-password', 'owner-password');
      return hash(data, rounds);
    }) as never);

    expect(await consumeResetToken(minted!.token, 'stale-password')).toBe(
      'invalid-token',
    );
    expect(await canLogInWith('owner-password')).toBe(true);
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

// Sessions and links name the account by name, which a deletion frees.
describe('an account registered again under a deleted name', () => {
  const recreate = async () => {
    await deletePlayer((await getPlayerByNameFromDb('Alice'))!.id);
    await createPlayer('Alice', await bcrypt.hash('new-owner', 10));
  };

  it('is at a generation the old sessions do not carry', async () => {
    const before = await authEpochOf('Alice');
    await recreate();

    expect(await authEpochOf('Alice')).not.toBe(before);
    expect(await authEpochOf('Alice')).not.toBe(0);
  });

  it('takes no password from a link the old account was sent', async () => {
    const minted = await createResetToken('Alice');
    await recreate();

    expect(await consumeResetToken(minted!.token, 'x-password')).toBe(
      'invalid-token',
    );
    expect(await canLogInWith('new-owner')).toBe(true);
  });

  it('takes no address from a link the old account was sent', async () => {
    const { token } = await createEmailToken(
      'Alice',
      'old@example.com',
      await epoch(),
    );
    await recreate();

    expect(await confirmEmailToken(token)).toBe('invalid-token');
    expect((await getPlayerByNameFromDb('Alice'))?.email).toBeUndefined();
  });
});

describe('address tokens', () => {
  const address = async () => (await getPlayerByNameFromDb('Alice'))?.email;

  // Stored on the way back, not on the way out: an address written before it
  // answers is a typo that sends the next reset link to a stranger.
  it('writes the address only once the link comes back', async () => {
    const minted = await createEmailToken(
      'Alice',
      'alice@example.com',
      await epoch(),
    );
    expect(await address()).toBeUndefined();

    expect(await confirmEmailToken(minted.token)).toBe('ok');
    expect(await address()).toBe('alice@example.com');
  });

  it('spends once', async () => {
    const minted = await createEmailToken(
      'Alice',
      'alice@example.com',
      await epoch(),
    );
    await confirmEmailToken(minted.token);

    expect(await confirmEmailToken(minted.token)).toBe('invalid-token');
  });

  it('refuses one that is out of date even while its row survives', async () => {
    const minted = await createEmailToken(
      'Alice',
      'alice@example.com',
      await epoch(),
    );
    await PasswordResetModel.updateOne(
      { username: 'Alice' },
      { expiresAt: new Date(Date.now() - RESET_TOKEN_TTL_MS) },
    ).exec();

    expect(await confirmEmailToken(minted.token)).toBe('invalid-token');
    expect(await address()).toBeUndefined();
  });

  // Two kinds of link live in one collection, and neither is the other kind of
  // permission: a link mailed to confirm an address must not set a password.
  it('is not a password reset, and a password reset is not one', async () => {
    const forAddress = await createEmailToken(
      'Alice',
      'alice@example.com',
      await epoch(),
    );
    const forPassword = await createResetToken('Alice');

    expect(await consumeResetToken(forAddress.token, 'new-password')).toBe(
      'invalid-token',
    );
    expect(await canLogInWith('old-password')).toBe(true);

    expect(await confirmEmailToken(forPassword!.token)).toBe('invalid-token');
    expect(await address()).toBeUndefined();
  });

  // The snapshot loop writes an online character back over its document, so
  // an address carried in from login would undo the confirmation.
  it('survives the online character being saved', async () => {
    const fx = createFixture();
    await confirmEmailToken(
      (await createEmailToken('Alice', 'old@example.com', await epoch())).token,
    );
    const record = await getPlayerByNameFromDb('Alice');
    enterWorld({ ...record!, mapId: fx.mapId });

    await confirmEmailToken(
      (await createEmailToken('Alice', 'new@example.com', await epoch())).token,
    );
    await persistPlayerSessionState(getPlayerByName('Alice')!);

    expect(await address()).toBe('new@example.com');
  });

  // Somebody who had the account long enough to point it at their own inbox
  // keeps that link unless the password change clears it too.
  it('dies with a password change, like a reset link', async () => {
    const minted = await createEmailToken(
      'Alice',
      'attacker@example.com',
      await epoch(),
    );

    await changePassword('Alice', 'old-password', 'new-password');

    expect(await confirmEmailToken(minted.token)).toBe('invalid-token');
    expect(await address()).toBeUndefined();
  });

  // The route checks the password before minting, and the owner's change
  // can land between the two, after the sweep that clears outstanding links.
  it('dies with a password change that lands before it is minted', async () => {
    const checked = await epoch();
    await changePassword('Alice', 'old-password', 'new-password');
    const minted = await createEmailToken(
      'Alice',
      'attacker@example.com',
      checked,
    );

    expect(await confirmEmailToken(minted.token)).toBe('invalid-token');
    expect(await address()).toBeUndefined();
  });

  it('is where a reset link is addressed', async () => {
    const minted = await createEmailToken(
      'Alice',
      'alice@example.com',
      await epoch(),
    );
    await confirmEmailToken(minted.token);

    expect((await createResetToken('Alice'))?.email).toBe('alice@example.com');
  });

  const confirm = async (email: string) =>
    confirmEmailToken(
      (await createEmailToken('Alice', email, await epoch())).token,
    );

  it('kills a reset link sent to the address it replaces', async () => {
    await confirm('old@example.com');
    const reset = await createResetToken('Alice');

    await confirm('new@example.com');

    expect(await consumeResetToken(reset!.token, 'x-password')).toBe(
      'invalid-token',
    );
    expect(await canLogInWith('old-password')).toBe(true);
  });

  // A typo the owner corrected is still in a stranger's inbox, and spent
  // after the right address it would send them the next reset link.
  it('dies once a newer one is minted', async () => {
    const typo = await createEmailToken(
      'Alice',
      'stranger@example.com',
      await epoch(),
    );
    await confirm('alice@example.com');

    expect(await confirmEmailToken(typo.token)).toBe('invalid-token');
    expect(await address()).toBe('alice@example.com');
  });

  // The address is read before the generation, and the owner can move both
  // in between: the link then carries the new generation to the old inbox.
  it('kills a reset link minted across an address change', async () => {
    await confirm('old@example.com');
    const find = playerRepository.findByName.bind(playerRepository);
    const read = vi
      .spyOn(playerRepository, 'findByName')
      .mockImplementationOnce(async (name) => {
        const before = await find(name);
        await changePassword('Alice', 'old-password', 'new-password');
        await confirm('new@example.com');
        return before;
      });
    onTestFinished(() => read.mockRestore());

    const reset = await createResetToken('Alice');

    expect(reset?.email).toBe('old@example.com');
    expect(await consumeResetToken(reset!.token, 'x-password')).toBe(
      'invalid-token',
    );
    expect(await canLogInWith('new-password')).toBe(true);
  });
});
