/**
 * The commands whose subject is a player, run the way the terminal runs
 * them: the same command answers every surface (terminal, web console,
 * in-game chat), and a privileged one leaves an audit trail entry.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  onTestFinished,
  vi,
} from 'vitest';
import { clearCommands, handleReplCommand } from '../engine/commands.js';
import { on } from '../engine/hooks.js';
import { registerPlayerCommands } from './playerCommands.js';
import { createFixture, tile } from '../sim/simFixture.js';
import { rebuildQuadtree } from '../sim/spatialManager.js';
import { runtimeState } from '../sim/state.js';
import { serverState } from '../services/serverState.js';
import { Access } from '../../shared/types.js';
import { TILE_SIZE } from '../../shared/constants.js';

const recordAdminAction = vi.fn();
vi.mock('../services/auditService.js', () => ({
  recordAdminAction: (entry: unknown) => recordAdminAction(entry),
  summarizeDetails: () => undefined,
}));
// Bans live in Mongo; what matters here is that the command reaches them.
vi.mock('../services/player/banService.js', () => ({
  unbanPlayer: () => Promise.resolve(),
  getBan: () => Promise.resolve(null),
}));
// The second factor is its own collection; the commands only have to reach it.
const disableTwoFactor = vi.fn().mockResolvedValue(true);
vi.mock('../services/player/twoFactorService.js', () => ({
  disableTwoFactor: (...args: unknown[]) => disableTwoFactor(...args),
  twoFactorStatus: () => Promise.resolve({ enabled: false, recoveryLeft: 0 }),
}));
// Same for the activity history: the commands have to reach it, and what it
// answers is its own file's business.
const forgetPlayer = vi.fn().mockResolvedValue(2);
vi.mock('../services/analyticsService.js', () => ({
  forgetPlayer: (...args: unknown[]) => forgetPlayer(...args),
  activityOf: () =>
    Promise.resolve([{ day: '2026-08-24', sessions: 1, minutes: 12 }]),
}));
const stored = new Map<string, Record<string, unknown>>();
const deletePlayer = vi.fn();
const disconnectPlayer = vi.fn().mockResolvedValue(undefined);
// The account's own spelling, as the real one reads it from Mongo.
const banAccount = vi.fn((name: string) =>
  Promise.resolve(name === 'alice' ? 'Alice' : null),
);
vi.mock('../services/player/playerService.js', async () => {
  const world = await import('../sim/world.js');
  return {
    banAccount: (...args: [string]) => banAccount(...args),
    getPlayerByName: world.getPlayerByName,
    getPlayerByNameFromDb: (name: string) =>
      Promise.resolve(stored.get(name) ?? null),
    deletePlayer: (id: string) => deletePlayer(id),
    disconnectPlayer: (name: string) => disconnectPlayer(name),
    kickPlayer: () => Promise.resolve(),
    levelUpPlayer: () => {},
    respawnPlayer: (p: { health: number; maxHealth: number }) => {
      p.health = p.maxHealth;
    },
  };
});
// The two answers a second process would give: who holds an account, and
// which instance serves a map. Both are reads against Mongo in production and
// both are what makes a destination "not here" rather than "not there".
const leaseHolderOf = vi.fn<(name: string) => Promise<string | null>>();
vi.mock('../persistence/presence.js', () => ({
  leaseHolderOf: (name: string) => leaseHolderOf(name),
}));
const publishToInstances = vi.fn();
vi.mock('../persistence/instanceBus.js', () => ({
  publishToInstances: (type: string, payload: unknown) =>
    publishToInstances(type, payload),
}));
const lookupInstanceUrl = vi.fn<(mapId: string) => string | undefined>();
vi.mock('../persistence/instanceRegistry.js', () => ({
  lookupInstanceUrl: (mapId: string) => lookupInstanceUrl(mapId),
}));

const cancelDelivery = vi.fn();
const mail: { id: string }[] = [];
vi.mock('../services/economy/deliveryService.js', () => ({
  listDeliveries: () => Promise.resolve(mail),
  cancelDelivery: (id: string) => {
    cancelDelivery(id);
    return Promise.resolve(true);
  },
}));

const dropListingsOf = vi.fn().mockResolvedValue(3);
vi.mock('../services/economy/auctionService.js', () => ({
  dropListingsOf: (seller: string) => dropListingsOf(seller),
}));

const run = async (line: string) => {
  const [name, ...args] = line.split(/\s+/);
  const out: string[] = [];
  const matched = await handleReplCommand(name!, args, (m) => out.push(m));
  return { matched, out: out.join('\n') };
};

beforeEach(() => {
  clearCommands();
  registerPlayerCommands();
  serverState.mutes.clear();
  recordAdminAction.mockClear();
  banAccount.mockClear();
  deletePlayer.mockClear();
  disconnectPlayer.mockClear();
  cancelDelivery.mockClear();
  dropListingsOf.mockClear();
  leaseHolderOf.mockReset().mockResolvedValue(null);
  publishToInstances.mockClear();
  lookupInstanceUrl.mockReset().mockReturnValue(undefined);
  stored.clear();
  mail.length = 0;
});

afterEach(() => clearCommands());

describe('reading who is here', () => {
  it('lists the online players with where they are', async () => {
    const sim = createFixture(0);
    sim.addPlayer({ name: 'Bob' });
    sim.addPlayer({ name: 'Alice', access: Access.ADMIN });

    const { out } = await run('players');

    expect(out).toContain('Online players');
    // Sorted by name, so the answer does not depend on who logged in first.
    expect(out.indexOf('Alice')).toBeLessThan(out.indexOf('Bob'));
    expect(out).toContain('ADMIN');
  });

  it('says so plainly when nobody is online', async () => {
    createFixture(0);
    expect((await run('players')).out).toBe('No players online.');
  });

  it('whois answers about one player, and names a missing one', async () => {
    const sim = createFixture(0);
    sim.addPlayer({ name: 'Alice', health: 42 });

    expect((await run('whois Alice')).out).toContain('42/100');
    expect((await run('whois Ghost')).out).toContain(
      'Player not online: Ghost',
    );
  });
});

describe('acting on a player', () => {
  it('heals to full by default and by amount when asked', async () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice', health: 10 });

    await run('heal Alice 15');
    expect(alice.health).toBe(25);

    await run('heal Alice');
    expect(alice.health).toBe(100);
  });

  it('kills and respawns in one command', async () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });

    const { out } = await run('kill Alice cheating');

    expect(alice.health).toBe(alice.maxHealth);
    expect(out).toContain('Killed Alice');
  });

  it('bans with a reason and a duration, hours last, under the account name', async () => {
    createFixture(0);

    const { out } = await run('ban alice being rude 3');

    expect(banAccount).toHaveBeenCalledWith(
      'alice',
      'being rude',
      expect.any(Number),
    );
    expect(out).toContain('Banned Alice for 3h');
  });

  it('says so when there is no account to ban', async () => {
    createFixture(0);

    expect((await run('ban Ghost')).out).toContain('No account named Ghost');
  });

  it('mutes for minutes, and permanently when none are given', async () => {
    createFixture(0);

    await run('mute Alice 30');
    expect(serverState.mutes.get('Alice')).toBeGreaterThan(Date.now());
    expect((await run('muteinfo Alice')).out).toContain('until');

    await run('mute Bob');
    // Zero is the stored form of "no expiry": a mute with a duration of none
    // would read as one that already ended.
    expect(serverState.mutes.get('Bob')).toBe(0);
    expect((await run('muteinfo Bob')).out).toContain('permanent');
  });
});

describe('teleporting', () => {
  const settle = () => {
    for (const [id, map] of Object.entries(runtimeState.maps)) {
      rebuildQuadtree(id, map);
    }
  };

  it('puts a player on the tile that was asked for', async () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });
    settle();

    const { out } = await run('tp Alice map1 5 7');

    expect(alice.position).toEqual(tile(5, 7));
    expect(out).toContain('tile (5,7)');
  });

  it('lands beside an occupied tile instead of on top of it', async () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });
    const bob = sim.addPlayer({ name: 'Bob', position: tile(5, 7) });
    settle();

    await run('tp Alice map1 5 7');

    expect(alice.position).not.toEqual(bob.position);
    // Beside, not across the map: one tile away in some direction.
    const dx = Math.abs(alice.position.x - bob.position.x) / TILE_SIZE;
    const dy = Math.abs(alice.position.y - bob.position.y) / TILE_SIZE;
    expect(Math.max(dx, dy)).toBe(1);
  });

  it('refuses a map it does not have instead of moving anyone', async () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });
    const before = { ...alice.position };
    settle();

    expect((await run('tp Alice nowhere 1 1')).out).toContain('Map not found');
    expect(alice.position).toEqual(before);
  });

  /**
   * tp across instances: the operator, the player and the destination can each
   * be on a different process. The command goes to whoever holds the account,
   * and the player then goes to whoever owns the map.
   */
  describe('across instances', () => {
    it('hands the player to the instance that owns the map', async () => {
      const sim = createFixture(0);
      const alice = sim.addPlayer({ name: 'Alice' });
      settle();
      lookupInstanceUrl.mockReturnValue('ws://two:8080');

      const { out } = await run('tp Alice faraway 3 4');

      expect(out).toContain('Sent Alice');
      expect(alice.mapId).toBe('faraway');
      // Redirected, not teleported into a map this process does not have.
      expect(disconnectPlayer).toHaveBeenCalledWith('Alice');
    });

    it('follows a subject held elsewhere instead of refusing', async () => {
      createFixture(0);
      leaseHolderOf.mockResolvedValue('ws://two:8080');

      const { out } = await run('tp Alice map1 5 7');

      expect(publishToInstances).toHaveBeenCalledWith('playerCommand', {
        command: 'tp',
        args: ['Alice', 'map1', '5', '7'],
        actor: 'console',
        source: 'repl',
      });
      expect(out).toContain('another instance');
    });

    it('goes to where a player held elsewhere last was', async () => {
      const sim = createFixture(0);
      const alice = sim.addPlayer({ name: 'Alice' });
      settle();
      leaseHolderOf.mockResolvedValue('ws://two:8080');
      lookupInstanceUrl.mockReturnValue('ws://two:8080');
      stored.set('Bob', {
        name: 'Bob',
        mapId: 'faraway',
        position: { x: 3 * TILE_SIZE, y: 4 * TILE_SIZE },
      });

      const { out } = await run('tp Alice Bob');

      // "last seen", since the document is only as fresh as the last
      // write-behind flush, and the answer says so.
      expect(out).toContain('last seen on map faraway tile (3,4)');
      expect(alice.mapId).toBe('faraway');
    });

    it('refuses a name that is merely offline, document or not', async () => {
      const sim = createFixture(0);
      const alice = sim.addPlayer({ name: 'Alice' });
      const before = { ...alice.position };
      settle();
      stored.set('Ghost', {
        name: 'Ghost',
        mapId: 'faraway',
        position: { x: 0, y: 0 },
      });

      const { out } = await run('tp Alice Ghost');

      expect(out).toContain('Target player not online: Ghost');
      expect(alice.position).toEqual(before);
    });

    it('refuses a map whose instance is gone instead of pretending', async () => {
      const sim = createFixture(0);
      const alice = sim.addPlayer({ name: 'Alice' });
      settle();
      // The lease outlives the registry entry of a process that died.
      leaseHolderOf.mockResolvedValue('ws://two:8080');
      stored.set('Bob', {
        name: 'Bob',
        mapId: 'faraway',
        position: { x: 0, y: 0 },
      });

      const { out } = await run('tp Alice Bob');

      expect(out).toContain('no instance is serving');
      expect(alice.mapId).toBe('map1');
    });
  });

  it('tpall moves everyone to one destination', async () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });
    const bob = sim.addPlayer({ name: 'Bob' });
    settle();

    await run('tpall map1 8 8');

    for (const player of [alice, bob]) {
      const dx = Math.abs(player.position.x - 8 * TILE_SIZE) / TILE_SIZE;
      const dy = Math.abs(player.position.y - 8 * TILE_SIZE) / TILE_SIZE;
      expect(Math.max(dx, dy)).toBeLessThanOrEqual(1);
    }
  });
});

describe('the trail', () => {
  it('records a privileged command typed at the terminal', async () => {
    const sim = createFixture(0);
    sim.addPlayer({ name: 'Alice' });

    await run('kill Alice');

    expect(recordAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'command kill',
        target: 'Alice',
        source: 'repl',
        actor: 'console',
      }),
    );
  });
});

// Account data. The obligation is the operator's; what the engine owes is a
// command, so nobody has to write the delete query by hand.
describe('account export and erasure', () => {
  const account = {
    id: 'p-1',
    name: 'Alice',
    password: 'a-bcrypt-hash',
    level: 4,
    data: { vip: true },
  };

  it('exports what is stored, without the password hash', async () => {
    stored.set('Alice', account);
    mail.push({ id: 'm1' });

    const { out } = await run('accountexport Alice');
    const parsed = JSON.parse(out) as {
      player: Record<string, unknown>;
      mail: unknown[];
      twoFactor: unknown;
      activity: unknown[];
    };

    expect(parsed.player).toMatchObject({ name: 'Alice', level: 4 });
    expect(parsed.player.data).toEqual({ vip: true });
    expect(parsed.player.password).toBeUndefined();
    expect(parsed.mail).toHaveLength(1);
    // The two things stored about the person rather than the character: that
    // there is a second factor (never its secret), and which days they played.
    expect(parsed.twoFactor).toEqual({ enabled: false, recoveryLeft: 0 });
    expect(parsed.activity).toEqual([
      { day: '2026-08-24', sessions: 1, minutes: 12 },
    ]);
  });

  it('says so plainly when there is no such account', async () => {
    const { out } = await run('accountexport Nobody');

    expect(out).toMatch(/No account named Nobody/);
    expect(out).not.toContain('{');
  });

  // The one command here with nothing behind it: no undo, no copy.
  it('refuses to erase without the typed confirmation', async () => {
    stored.set('Alice', account);

    const { out } = await run('accountdelete Alice');

    expect(out).toMatch(/permanently/);
    expect(deletePlayer).not.toHaveBeenCalled();
  });

  it('erases the account and its queued mail once confirmed', async () => {
    stored.set('Alice', account);
    mail.push({ id: 'm1' }, { id: 'm2' });

    const { out } = await run('accountdelete Alice confirm');

    expect(deletePlayer).toHaveBeenCalledWith('p-1');
    expect(cancelDelivery).toHaveBeenCalledTimes(2);
    expect(out).toMatch(/Erased Alice/);
    // The activity is anonymised, not deleted: those rows are what the day's
    // player count was made of. The reply says how many days it touched.
    expect(forgetPlayer).toHaveBeenCalledWith('Alice');
    expect(out).toMatch(/2 days of activity anonymised/);
  });

  it('disconnects a live session first, or the snapshot writes it back', async () => {
    stored.set('Alice', account);
    const sim = createFixture(0);
    sim.addPlayer({ name: 'Alice' });

    await run('accountdelete Alice confirm');

    expect(disconnectPlayer).toHaveBeenCalledWith('Alice');
  });

  // Kept under the name, which the erasure frees: left in place, a listing and
  // its takings would go to whoever registers the name next.
  it('drops the auction listings sold under the name', async () => {
    stored.set('Alice', account);

    const { out } = await run('accountdelete Alice confirm');

    expect(dropListingsOf).toHaveBeenCalledWith('Alice');
    expect(out).toMatch(/3 auction listings dropped/);
  });

  it('tells the modules the name is free, once the account is gone', async () => {
    stored.set('Alice', account);
    const told: string[] = [];
    const stop = on('accountDeleted', ({ name }) => {
      expect(deletePlayer).toHaveBeenCalled();
      told.push(name);
    });
    onTestFinished(stop);

    await run('accountdelete Alice confirm');

    expect(told).toEqual(['Alice']);
  });

  it('leaves an audit entry, like every other privileged action', async () => {
    stored.set('Alice', account);

    await run('accountdelete Alice confirm');

    expect(recordAdminAction).toHaveBeenCalled();
  });
});

describe('the second factor from the console', () => {
  beforeEach(() => {
    stored.set('Alice', { id: 'p-1', name: 'Alice' });
    disableTwoFactor.mockClear();
  });

  it('says what the account has', async () => {
    const { out } = await run('twofactor Alice');

    expect(out).toMatch(/second factor/i);
    expect(disableTwoFactor).not.toHaveBeenCalled();
  });

  it('removes it when asked, which is the way back from a lost phone', async () => {
    const { out } = await run('twofactor Alice off');

    expect(disableTwoFactor).toHaveBeenCalledWith('Alice');
    expect(out).toMatch(/removed from Alice/);
  });

  it('will not act on an account that does not exist', async () => {
    const { out } = await run('twofactor Ghost off');

    expect(disableTwoFactor).not.toHaveBeenCalled();
    expect(out).toMatch(/No account named Ghost/);
  });

  // There is no "on": enrolling means holding the secret, and a secret that
  // passed through an operator is not a second factor any more.
  it('has no way to turn it on for somebody else', async () => {
    const { out } = await run('twofactor Alice on');

    expect(disableTwoFactor).not.toHaveBeenCalled();
    expect(out).toMatch(/second factor/i);
  });
});
