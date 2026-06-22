// Exercises the real shipped guild module (modules/guild) end to end, so the
// proof module can't silently rot.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadModules, unloadAllModules } from './moduleLoader.js';
import { handleChatCommand, clearCommands } from '../commands.js';
import { kvGet, clearKvStoreMemory } from '../../persistence/kvStore.js';
import { drainGameEvents } from '../eventBus.js';
import { createFixture } from '../../sim/simFixture.js';
import { Access } from '../../../shared/types.js';

interface Guild {
  name: string;
  leader: string;
  members: string[];
}

beforeEach(() => {
  clearCommands();
  clearKvStoreMemory();
  drainGameEvents();
  loadModules(); // real modules/ (guild enabled in game.json)
});

afterEach(() => {
  unloadAllModules();
  clearCommands();
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
});
