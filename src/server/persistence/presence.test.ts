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
import type { PlayerServer } from '../../shared/types.js';

// This process is one instance; the other one is written straight into the
// documents below, which is exactly what it looks like from here.
const OTHER = 'ws://beta:8080';

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config.js')>();
  return {
    ...actual,
    config: {
      ...actual.config,
      instance: {
        ...actual.config.instance,
        wsPublicUrl: 'ws://alpha:8080',
        heartbeatMs: 30_000,
      },
    },
  };
});

const PlayerModel = (await import('../model/Player.js')).default;
const {
  acquirePresence,
  listOnlineEverywhere,
  presenceFence,
  releaseAllPresence,
  releasePresence,
  renewPresence,
} = await import('./presence.js');
const { playerRepository } = await import('./playerRepository.js');

let mongod: MongoMemoryServer;

type Lease = { owner?: string; token?: string; until?: number };
const leaseOf = async (id: string): Promise<Lease | undefined> =>
  (await PlayerModel.findOne({ id }).select('lease').lean<{ lease?: Lease }>())
    ?.lease;

const givePlayer = async (id: string) => {
  await PlayerModel.create({ id, name: id, password: 'x', health: 10 });
};

const heldByOther = async (id: string, until: number) => {
  await PlayerModel.updateOne(
    { id },
    { $set: { lease: { owner: OTHER, token: 'other-token', until } } },
  );
};

beforeAll(async () => {
  mongod = await startMemoryMongo();
  await mongoose.connect(mongod.getUri());
}, 30_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  await releaseAllPresence();
  await PlayerModel.deleteMany({});
});

describe('taking an account', () => {
  it('takes one nobody holds, and remembers the token it stamped', async () => {
    await givePlayer('p1');

    expect(await acquirePresence('p1', 'p1')).toEqual({
      ok: true,
      fresh: true,
    });

    const lease = await leaseOf('p1');
    expect(lease?.owner).toBe('ws://alpha:8080');
    expect(presenceFence('p1')).toEqual({ 'lease.token': lease?.token });
    // A second entry here finds it held, and must not let go of it on failure.
    expect(await acquirePresence('p1', 'p1')).toEqual({
      ok: true,
      fresh: false,
    });
  });

  it('refuses one another instance is holding, and says who has it', async () => {
    await givePlayer('p2');
    await heldByOther('p2', Date.now() + 60_000);

    expect(await acquirePresence('p2', 'p2')).toEqual({
      ok: false,
      owner: OTHER,
    });
    // Nothing was stamped, so nothing is fenced: this process must not write a
    // player it did not get.
    expect(presenceFence('p2')).toEqual({});
    expect((await leaseOf('p2'))?.owner).toBe(OTHER);
  });

  it('takes over one whose holder stopped renewing', async () => {
    await givePlayer('p3');
    await heldByOther('p3', Date.now() - 1);

    expect(await acquirePresence('p3', 'p3')).toEqual({
      ok: true,
      fresh: true,
    });
    expect((await leaseOf('p3'))?.owner).toBe('ws://alpha:8080');
  });

  it('lets go on release, so the next instance can have it', async () => {
    await givePlayer('p4');
    await acquirePresence('p4', 'p4');

    await releasePresence('p4');

    expect(await leaseOf('p4')).toBeUndefined();
    expect(presenceFence('p4')).toEqual({});
  });

  it('pushes the expiry on every heartbeat', async () => {
    await givePlayer('p5');
    await acquirePresence('p5', 'p5');
    // The clock cannot be moved forward here without moving it for Mongo too,
    // so the lease is aged instead. Renewing has to put it back in the future,
    // and it has to find it by the token rather than by being unexpired.
    await PlayerModel.updateOne(
      { id: 'p5' },
      { $set: { 'lease.until': Date.now() - 1 } },
    );

    await renewPresence();

    expect((await leaseOf('p5'))?.until).toBeGreaterThan(Date.now());
  });
});

describe('who is online, across the fleet', () => {
  it("reads the leases rather than this process's sockets", async () => {
    await givePlayer('o1');
    await givePlayer('o2');
    await givePlayer('o3');
    await acquirePresence('o1', 'o1');
    // Logged in on the other instance, which from here is exactly a lease it
    // holds; this process's socket map would not show it.
    await heldByOther('o2', Date.now() + 60_000);
    // Was online, is not: an expired lease is not a player.
    await heldByOther('o3', Date.now() - 1);

    expect((await listOnlineEverywhere())?.sort()).toEqual(['o1', 'o2']);
  });
});

describe('the fence on the write itself', () => {
  const character = (id: string) =>
    ({ id, name: id, health: 3 }) as unknown as PlayerServer;

  it('writes while this instance still owns the account', async () => {
    await givePlayer('w1');
    await acquirePresence('w1', 'w1');

    expect(await playerRepository.save(character('w1'))).toBe(true);
  });

  it('refuses the write once the account was taken away', async () => {
    await givePlayer('w2');
    await acquirePresence('w2', 'w2');

    // What a partition looks like from the other side: this process was late,
    // somebody else took the account, and the pause it was in ends here.
    await heldByOther('w2', Date.now() + 60_000);

    expect(await playerRepository.save(character('w2'))).toBe(false);
    // The document still belongs to whoever took it, untouched.
    expect((await leaseOf('w2'))?.owner).toBe(OTHER);
  });

  it('does not fence a player this instance never took', async () => {
    await givePlayer('w3');

    expect(await playerRepository.save(character('w3'))).toBe(true);
  });
});

describe('a write to an account nobody is playing', () => {
  const gains = { attack: 2, unspentPoints: -2 };

  it('lands on a free account, and only while it has the points', async () => {
    await PlayerModel.create({
      id: 'f1',
      name: 'f1',
      password: 'x',
      attack: 1,
      unspentPoints: 3,
    });

    const saved = await playerRepository.addStatsOffline('f1', gains);

    expect(saved?.attack).toBe(3);
    expect(saved?.unspentPoints).toBe(1);
    expect(saved).not.toHaveProperty('lease');
    expect(await playerRepository.addStatsOffline('f1', gains)).toBeNull();
  });

  // The holder saves the whole character from memory on its next snapshot,
  // which would put the points back and take the attack away.
  it('matches nothing while an instance is playing it, this one included', async () => {
    await PlayerModel.create({
      id: 'f2',
      name: 'f2',
      password: 'x',
      unspentPoints: 5,
    });
    await heldByOther('f2', Date.now() + 60_000);
    expect(await playerRepository.addStatsOffline('f2', gains)).toBeNull();

    await heldByOther('f2', Date.now() - 1);
    await acquirePresence('f2', 'f2');
    expect(await playerRepository.addStatsOffline('f2', gains)).toBeNull();

    await releasePresence('f2');
    expect(
      (await playerRepository.addStatsOffline('f2', gains))?.unspentPoints,
    ).toBe(3);
  });
});
