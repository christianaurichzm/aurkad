// Exercises the real social module: friends are a one-way bookmark, the ignore
// list is policy the module owns but the core enforces, and the two survive a
// logout in player.data while the runtime copy does not.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unloadAllModules } from './moduleLoader.js';
import { loadModulesForTest } from '../../../test/modules.js';
import { clearProvides, useApi } from './registry.js';
import { clearCommands } from '../commands.js';
import { clearAll, emit } from '../hooks.js';
import { drainGameEvents } from '../eventBus.js';
import { serverState } from '../../services/world/serverState.js';
import { createFixture } from '../../sim/simFixture.js';

let sim: ReturnType<typeof createFixture>;

beforeEach(() => {
  clearAll();
  clearCommands();
  clearProvides();
  drainGameEvents();
  serverState.ignores.clear();
  sim = createFixture(0);
  loadModulesForTest('social');
});

afterEach(() => {
  unloadAllModules();
  clearAll();
  clearProvides();
  serverState.ignores.clear();
});

const social = () =>
  useApi<{
    friends: (p: unknown) => string[];
    ignored: (p: unknown) => string[];
    isFriend: (p: unknown, name: string) => boolean;
    isIgnored: (p: unknown, name: string) => boolean;
    addFriend: (p: unknown, name: string) => string;
    removeFriend: (p: unknown, name: string) => string;
    addIgnored: (p: unknown, name: string) => string;
    removeIgnored: (p: unknown, name: string) => string;
  }>('social')!;

describe('friends', () => {
  it('is a one-way bookmark: adding does not add back', () => {
    const me = sim.addPlayer({ name: 'Ana' });
    const them = sim.addPlayer({ name: 'Bo' });

    social().addFriend(me, 'Bo');

    expect(social().friends(me)).toEqual(['Bo']);
    expect(social().friends(them)).toEqual([]);
  });

  it('needs the player to exist, so a typo is not stored forever', () => {
    const me = sim.addPlayer({ name: 'Ana' });

    social().addFriend(me, 'Nobody');

    expect(social().friends(me)).toEqual([]);
  });

  it('refuses the player themselves and a name already listed', () => {
    const me = sim.addPlayer({ name: 'Ana' });
    sim.addPlayer({ name: 'Bo' });

    social().addFriend(me, 'Ana');
    social().addFriend(me, 'Bo');
    social().addFriend(me, 'bo'); // same person, typed differently

    expect(social().friends(me)).toEqual(['Bo']);
  });

  it('removes case-insensitively, because chat rarely matches case', () => {
    const me = sim.addPlayer({ name: 'Ana' });
    sim.addPlayer({ name: 'Bo' });
    social().addFriend(me, 'Bo');

    social().removeFriend(me, 'bO');

    expect(social().friends(me)).toEqual([]);
  });

  it('tells the watcher when a friend arrives and when they go', () => {
    const watcher = sim.addPlayer({ name: 'Ana' });
    const friend = sim.addPlayer({ name: 'Bo' });
    social().addFriend(watcher, 'Bo');
    drainGameEvents();

    emit('playerJoin', { player: friend });
    emit('playerLeave', { player: friend });

    const lines = drainGameEvents()
      .filter((e) => e.type === 'chatPlayer' && e.username === 'Ana')
      .map((e) => (e as { payload: { message: string } }).payload.message);
    expect(lines).toEqual(['Bo logged in.', 'Bo logged out.']);
  });

  it('says nothing to someone who did not list them', () => {
    sim.addPlayer({ name: 'Ana' });
    const stranger = sim.addPlayer({ name: 'Bo' });
    drainGameEvents();

    emit('playerJoin', { player: stranger });

    expect(drainGameEvents().filter((e) => e.type === 'chatPlayer')).toEqual(
      [],
    );
  });
});

describe('ignore', () => {
  it('takes a name whose owner is offline - the usual reason to ignore', () => {
    const me = sim.addPlayer({ name: 'Ana' });

    social().addIgnored(me, 'GoneAlready');

    expect(social().ignored(me)).toEqual(['GoneAlready']);
  });

  it('reaches the core, which is what actually drops the chat', () => {
    const me = sim.addPlayer({ name: 'Ana' });
    sim.addPlayer({ name: 'Bo' });

    social().addIgnored(me, 'Bo');
    expect([...(serverState.ignores.get('Ana') ?? [])]).toEqual(['Bo']);

    social().removeIgnored(me, 'Bo');
    expect(serverState.ignores.get('Ana')).toBeUndefined();
  });

  it('refuses the player themselves', () => {
    const me = sim.addPlayer({ name: 'Ana' });

    social().addIgnored(me, 'ana');

    expect(social().ignored(me)).toEqual([]);
  });

  it('survives the logout in player data, but not in the core', () => {
    const me = sim.addPlayer({ name: 'Ana' });
    social().addIgnored(me, 'Bo');

    emit('playerLeave', { player: me });

    expect(serverState.ignores.get('Ana')).toBeUndefined();
    expect(social().ignored(me)).toEqual(['Bo']); // still in player.data

    emit('playerJoin', { player: me });
    expect([...(serverState.ignores.get('Ana') ?? [])]).toEqual(['Bo']);
  });
});

describe('the two lists together', () => {
  it('stores each under its own key, so neither reads the other', () => {
    const me = sim.addPlayer({ name: 'Ana' });
    sim.addPlayer({ name: 'Bo' });
    sim.addPlayer({ name: 'Cy' });

    social().addFriend(me, 'Bo');
    social().addIgnored(me, 'Cy');

    expect(social().isFriend(me, 'Bo')).toBe(true);
    expect(social().isIgnored(me, 'Bo')).toBe(false);
    expect(social().isIgnored(me, 'Cy')).toBe(true);
    expect(social().isFriend(me, 'Cy')).toBe(false);
  });
});
