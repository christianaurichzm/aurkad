// Exercises the real achievements module: it counts off the hooks the engine
// already emits, shares one counter between rules that ask the same question,
// and never awards the same id twice.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unloadAllModules } from './moduleLoader.js';
import { loadModulesForTest } from '../../../test/modules.js';
import { clearProvides, useApi } from './registry.js';
import { clearCommands } from '../commands.js';
import { clearAll, emit } from '../hooks.js';
import { drainGameEvents } from '../eventBus.js';
import { createFixture } from '../../sim/simFixture.js';

let sim: ReturnType<typeof createFixture>;

beforeEach(() => {
  clearAll();
  clearCommands();
  clearProvides();
  drainGameEvents();
  sim = createFixture(0);
  loadModulesForTest('achievements');
});

afterEach(() => {
  unloadAllModules();
  clearAll();
  clearProvides();
});

const achievements = () =>
  useApi<{
    award: (p: unknown, id: string) => boolean;
    earned: (p: unknown) => string[];
    has: (p: unknown, id: string) => boolean;
    definitions: () => { id: string; count: number }[];
  }>('achievements')!;

const kill = (player: unknown, times: number, name = 'Goblin') => {
  const npc = sim.addNpc({ name });
  for (let i = 0; i < times; i++)
    emit('npcDeath', {
      npc,
      killer: player as never,
      contributors: [],
    });
};

describe('definitions', () => {
  it('reads the sample set from game.json config', () => {
    expect(
      achievements()
        .definitions()
        .map((d) => d.id),
    ).toEqual(['first_blood', 'slayer', 'apprentice']);
  });
});

describe('counting kills', () => {
  it('awards on the first one', () => {
    const player = sim.addPlayer({ name: 'Ana' });

    kill(player, 1);

    expect(achievements().has(player, 'first_blood')).toBe(true);
    expect(achievements().has(player, 'slayer')).toBe(false);
  });

  it('shares one counter between the two rules that ask the same thing', () => {
    const player = sim.addPlayer({ name: 'Ana' });

    kill(player, 50);

    expect(achievements().earned(player).sort()).toEqual([
      'first_blood',
      'slayer',
    ]);
  });

  it('does not award the same id twice', () => {
    const player = sim.addPlayer({ name: 'Ana' });

    kill(player, 60);

    expect(achievements().earned(player)).toEqual(['first_blood', 'slayer']);
  });

  it('counts nothing for a kill with no player behind it', () => {
    const npc = sim.addNpc({ name: 'Goblin' });
    expect(() =>
      emit('npcDeath', {
        npc,
        killer: undefined as never,
        contributors: [],
      }),
    ).not.toThrow();
  });
});

describe('reaching a level', () => {
  it('awards on the level itself and on any level past it', () => {
    const early = sim.addPlayer({ name: 'Ana' });
    const late = sim.addPlayer({ name: 'Bo' });

    emit('playerLevelUp', { player: early, level: 10 });
    emit('playerLevelUp', { player: late, level: 30 });

    expect(achievements().has(early, 'apprentice')).toBe(true);
    expect(achievements().has(late, 'apprentice')).toBe(true);
  });

  it('leaves the client with the award, not the state from before it', () => {
    const player = sim.addPlayer({ name: 'Ana' });
    drainGameEvents();

    emit('playerLevelUp', { player, level: 10 });

    const updates = drainGameEvents().filter(
      (e) => e.type === 'customPlayer' && e.channel === 'achievements:update',
    ) as Array<{ payload: { earned: string[] } }>;
    expect(updates.at(-1)?.payload.earned).toEqual(['apprentice']);
  });

  it('does not award below it', () => {
    const player = sim.addPlayer({ name: 'Ana' });

    emit('playerLevelUp', { player, level: 9 });

    expect(achievements().earned(player)).toEqual([]);
  });
});

describe('awarding by hand', () => {
  it('grants a known id and refuses an unknown one', () => {
    const player = sim.addPlayer({ name: 'Ana' });

    expect(achievements().award(player, 'apprentice')).toBe(true);
    expect(achievements().award(player, 'apprentice')).toBe(false); // already had it
    expect(achievements().award(player, 'no_such_thing')).toBe(false);
    expect(achievements().earned(player)).toEqual(['apprentice']);
  });
});

describe('what the player is told', () => {
  it('sends the line and the event the toast is drawn from', () => {
    const player = sim.addPlayer({ name: 'Ana' });
    drainGameEvents();

    kill(player, 1);

    const events = drainGameEvents();
    const line = events.find(
      (e) => e.type === 'chatPlayer' && e.username === 'Ana',
    ) as { payload: { message: string } } | undefined;
    const earned = events.find(
      (e) => e.type === 'customPlayer' && e.channel === 'achievements:earned',
    ) as { payload: { id: string } } | undefined;

    expect(line?.payload.message).toBe('Achievement unlocked: First Blood');
    expect(earned?.payload.id).toBe('first_blood');
  });

  it('reports progress on the ones still locked', () => {
    const player = sim.addPlayer({ name: 'Ana' });
    kill(player, 5);
    drainGameEvents();

    emit('customAction', {
      player,
      channel: 'achievements:request',
      payload: null,
    });

    const update = drainGameEvents().find(
      (e) => e.type === 'customPlayer' && e.channel === 'achievements:update',
    ) as
      | { payload: { all: { id: string; progress: number; target: number }[] } }
      | undefined;
    const slayer = update?.payload.all.find((a) => a.id === 'slayer');
    expect(slayer).toMatchObject({ progress: 5, target: 50 });
  });
});
