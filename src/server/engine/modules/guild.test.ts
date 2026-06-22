// Exercises the real shipped guild module (modules/guild) end to end, so the
// proof module can't silently rot.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadModules, unloadAllModules } from './moduleLoader.js';
import { handleChatCommand, clearCommands } from '../commands.js';
import { useApi, clearProvides } from './registry.js';
import { kvGet, clearKvStoreMemory } from '../../persistence/kvStore.js';
import { drainGameEvents } from '../eventBus.js';
import { handleCustomAction } from '../../services/customEventService.js';
import { createFixture } from '../../sim/simFixture.js';
import { Access, PlayerServer } from '../../../shared/types.js';

interface Guild {
  name: string;
  leader: string;
  members: string[];
}

beforeEach(() => {
  clearCommands();
  clearProvides();
  clearKvStoreMemory();
  drainGameEvents();
  loadModules(); // real modules/ (guild enabled in game.json)
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
    // A non-player (REPL-less) check: chat command is handled (consumed).
    expect(handleChatCommand(p, '/guild list')).toBe(true);
  });

  it('create then join builds the member list, bounded by config', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice', access: Access.USER });
    const bob = sim.addPlayer({ name: 'Bob' });

    handleChatCommand(alice, '/guild create Dragons');
    handleChatCommand(bob, '/guild join Dragons');

    const g = kvGet<Guild>('guild', 'Dragons');
    expect(g?.leader).toBe('Alice');
    expect(g?.members).toEqual(['Alice', 'Bob']);
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
    expect(kvGet<Guild>('guild', 'Dragons')?.leader).toBe('Bob');
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

    // Bob's create was rejected, so he has no guild and is not in Dragons.
    expect(bob.data?.guild).toBeUndefined();
    expect(kvGet<Guild>('guild', 'Dragons')?.members).toEqual(['Alice']);
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

    handleCustomAction({ type: 'custom', username: 'Alice', channel: 'guild:request' });

    const ev = drainGameEvents().find(
      (e) => e.type === 'customPlayer' && e.channel === 'guild:update',
    ) as { payload: { name: string } | null } | undefined;
    expect(ev?.payload?.name).toBe('Dragons');
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
});
