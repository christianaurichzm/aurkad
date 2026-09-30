// Exercises the real shipped guild module (modules/guild) end to end, so the
// proof module can't silently rot.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unloadAllModules } from './moduleLoader.js';
import { loadModulesForTest } from '../../../test/modules.js';
import { handleChatCommand, clearCommands } from '../commands.js';
import { useApi, clearProvides } from './registry.js';
import { kvGet, clearKvStoreMemory } from '../../persistence/kvStore.js';
import { drainGameEvents } from '../eventBus.js';
import { handleCustomAction } from '../../services/comms/customEventService.js';
import { createFixture } from '../../sim/simFixture.js';
import { Access, PlayerServer } from '../../../shared/types.js';
import { emit } from '../hooks.js';
import { gameConfig } from '../../gameConfig.js';

interface GuildMember {
  name: string;
  role: 'owner' | 'moderator' | 'member';
}

interface Guild {
  name: string;
  leader: string;
  privacy: 'public' | 'private';
  members: GuildMember[];
  invites: string[];
}

beforeEach(() => {
  clearCommands();
  clearProvides();
  clearKvStoreMemory();
  drainGameEvents();
  loadModulesForTest('guild');
});

afterEach(() => {
  unloadAllModules();
  clearCommands();
  clearProvides();
});

describe('guild module', () => {
  it('registers the /guild command', () => {
    const sim = createFixture(0);
    const p = sim.addPlayer({ name: 'Alice' });
    expect(handleChatCommand(p, '/guild info')).toBe(true);
  });

  it('create then join builds the member list, bounded by config', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice', access: Access.USER });
    const bob = sim.addPlayer({ name: 'Bob' });

    handleChatCommand(alice, '/guild create Dragons');
    handleChatCommand(bob, '/guild join Dragons');

    const g = kvGet<Guild>('guild', 'Dragons');
    expect(g?.leader).toBe('Alice');
    expect(g?.members.map((m) => m.name)).toEqual(['Alice', 'Bob']);
    expect(g?.members.find((m) => m.name === 'Alice')?.role).toBe('owner');
    expect(g?.members.find((m) => m.name === 'Bob')?.role).toBe('member');
    expect(alice.data?.guild).toBe('Dragons');
    expect(bob.data?.guild).toBe('Dragons');
  });

  it('leaving passes leadership; emptying disbands', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });
    const bob = sim.addPlayer({ name: 'Bob' });

    handleChatCommand(alice, '/guild create Dragons');
    handleChatCommand(bob, '/guild join Dragons');

    handleChatCommand(alice, '/guild leave');
    const afterLeave = kvGet<Guild>('guild', 'Dragons');
    expect(afterLeave?.members.find((m) => m.role === 'owner')?.name).toBe(
      'Bob',
    );
    expect(alice.data?.guild).toBeUndefined();

    handleChatCommand(bob, '/guild leave');
    expect(kvGet('guild', 'Dragons')).toBeUndefined(); // disbanded
  });

  it('cannot create a guild whose name is taken', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });
    const bob = sim.addPlayer({ name: 'Bob' });

    handleChatCommand(alice, '/guild create Dragons');
    handleChatCommand(bob, '/guild create Dragons');

    expect(bob.data?.guild).toBeUndefined();
    expect(
      kvGet<Guild>('guild', 'Dragons')?.members.map((m) => m.name),
    ).toEqual(['Alice']);
  });

  it('pushes guild:update to members (drives the client panel)', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });
    drainGameEvents();

    handleChatCommand(alice, '/guild create Dragons');

    const ev = drainGameEvents().find(
      (e) => e.type === 'customPlayer' && e.channel === 'guild:update',
    ) as { username: string; payload: { name: string } } | undefined;
    expect(ev?.username).toBe('Alice');
    expect(ev?.payload.name).toBe('Dragons');
  });

  it('answers guild:request with the player current guild', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });
    handleChatCommand(alice, '/guild create Dragons');
    drainGameEvents();

    handleCustomAction({
      type: 'custom',
      username: 'Alice',
      channel: 'guild:request',
    });

    const ev = drainGameEvents().find(
      (e) => e.type === 'customPlayer' && e.channel === 'guild:update',
    ) as { payload: { name: string } | null } | undefined;
    expect(ev?.payload?.name).toBe('Dragons');
  });

  it('creates and leaves a guild via UI custom actions, and sets the name tag', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });

    handleCustomAction({
      type: 'custom',
      username: 'Alice',
      channel: 'guild:create',
      payload: { name: 'Dragons' },
    });

    expect(
      kvGet<Guild>('guild', 'Dragons')?.members.map((m) => m.name),
    ).toEqual(['Alice']);
    expect(alice.data?.guild).toBe('Dragons');
    expect(alice.nameTag).toBe('Dragons'); // shown above the name on the canvas

    handleCustomAction({
      type: 'custom',
      username: 'Alice',
      channel: 'guild:leave',
    });

    expect(alice.data?.guild).toBeUndefined();
    expect(alice.nameTag).toBeUndefined(); // tag cleared on leave
    expect(kvGet('guild', 'Dragons')).toBeUndefined();
  });

  it('tells the window who is in the game, which guilds are open, and why not', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice', level: 4 });
    sim.addPlayer({ name: 'Bob' });
    sim.addPlayer({ name: 'Carol' });
    handleChatCommand(alice, '/guild create Dragons');
    handleChatCommand(alice, '/guild create Hidden private');
    const ask = (username: string, channel: string, payload?: unknown) => {
      drainGameEvents();
      handleCustomAction({ type: 'custom', username, channel, payload });
      return drainGameEvents().filter((e) => e.type === 'customPlayer') as {
        username: string;
        channel: string;
        payload: Record<string, unknown>;
      }[];
    };

    expect(ask('Bob', 'guild:list')[0]?.payload).toEqual({
      guilds: [{ name: 'Dragons', members: 1 }],
      maxMembers: 50,
    });

    const joined = ask('Bob', 'guild:join', { name: 'Dragons' });
    expect(joined.find((e) => e.username === 'Alice')?.payload.members).toEqual(
      [
        { name: 'Alice', role: 'owner', online: true, level: 4 },
        { name: 'Bob', role: 'member', online: true, level: 1 },
      ],
    );
    expect(joined.find((e) => e.channel === 'guild:result')?.payload).toEqual({
      message: 'Joined "Dragons".',
    });

    expect(ask('Carol', 'guild:create', { name: 'Dragons' })).toEqual([
      expect.objectContaining({
        channel: 'guild:result',
        payload: { message: 'That guild name is taken.' },
      }),
    ]);

    // Bob logs out: the ones who stay see him go offline.
    drainGameEvents();
    emit('playerLeave', { player: sim.getPlayer('Bob') });
    const left = drainGameEvents().filter((e) => e.type === 'customPlayer') as {
      username: string;
      payload: { members: { online: boolean }[] };
    }[];
    expect(left.map((e) => e.username)).toEqual(['Alice']);
    expect(left[0]?.payload.members.map((m) => m.online)).toEqual([
      true,
      false,
    ]);
  });

  it('exposes a guild API via use("guild")', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });
    handleChatCommand(alice, '/guild create Dragons');

    const api = useApi<{
      guildOf: (p: PlayerServer) => Guild | undefined;
      isMember: (p: PlayerServer, name: string) => boolean;
      members: (name: string) => string[];
    }>('guild');

    expect(api?.guildOf(alice)?.name).toBe('Dragons');
    expect(api?.isMember(alice, 'Dragons')).toBe(true);
    expect(api?.members('Dragons')).toEqual(['Alice']);
  });

  it('private guild rejects /guild join and requires invite', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });
    const bob = sim.addPlayer({ name: 'Bob' });

    handleChatCommand(alice, '/guild create Secret private');
    handleChatCommand(bob, '/guild join Secret');

    expect(bob.data?.guild).toBeUndefined();
    expect(kvGet<Guild>('guild', 'Secret')?.members).toHaveLength(1);
  });

  it('invite flow: invite → accept adds member', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });
    const bob = sim.addPlayer({ name: 'Bob' });

    handleChatCommand(alice, '/guild create Dragons');
    handleChatCommand(alice, '/guild invite Bob');

    expect(kvGet<Guild>('guild', 'Dragons')?.invites).toContain('Bob');

    handleChatCommand(bob, '/guild accept Dragons');

    const g = kvGet<Guild>('guild', 'Dragons');
    expect(g?.members.map((m) => m.name)).toContain('Bob');
    expect(g?.invites).not.toContain('Bob');
    expect(bob.data?.guild).toBe('Dragons');
  });

  it('owner can promote and demote members', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });
    const bob = sim.addPlayer({ name: 'Bob' });

    handleChatCommand(alice, '/guild create Dragons');
    handleChatCommand(bob, '/guild join Dragons');
    handleChatCommand(alice, '/guild promote Bob');

    expect(
      kvGet<Guild>('guild', 'Dragons')?.members.find((m) => m.name === 'Bob')
        ?.role,
    ).toBe('moderator');

    handleChatCommand(alice, '/guild demote Bob');
    expect(
      kvGet<Guild>('guild', 'Dragons')?.members.find((m) => m.name === 'Bob')
        ?.role,
    ).toBe('member');
  });
});

describe('guild dungeon copies', () => {
  const ownerOf = (player: PlayerServer, owner = player.name) => {
    const ctx = { player, mapId: '3', owner };
    emit('instanceOwner', ctx);
    return ctx.owner;
  };
  const guildOfTwo = () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });
    const bob = sim.addPlayer({ name: 'Bob' });
    handleChatCommand(alice, '/guild create Dragons');
    handleChatCommand(bob, '/guild join Dragons');
    return { sim, alice, bob };
  };
  const reloadWith = (sharedInstances: boolean) => {
    unloadAllModules();
    clearCommands();
    clearProvides();
    gameConfig.modules.guild = {
      ...gameConfig.modules.guild,
      config: { ...gameConfig.modules.guild?.config, sharedInstances },
    };
    loadModulesForTest('guild');
  };

  afterEach(() => reloadWith(false));

  it('leaves each member a copy of their own by default', () => {
    const { alice } = guildOfTwo();

    expect(ownerOf(alice)).toBe('Alice');
  });

  it('gives guildmates one copy when sharedInstances is on', () => {
    reloadWith(true);
    const { sim, alice, bob } = guildOfTwo();
    const carol = sim.addPlayer({ name: 'Carol' });

    expect(ownerOf(alice)).toBe('guild:Dragons');
    expect(ownerOf(bob)).toBe('guild:Dragons');
    expect(ownerOf(carol)).toBe('Carol');
  });

  it('leaves a copy another group already claimed (a party)', () => {
    reloadWith(true);
    const { alice } = guildOfTwo();

    expect(ownerOf(alice, 'party:Carol')).toBe('party:Carol');
  });
});
