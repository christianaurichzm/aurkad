// Exercises the real leaderboard module: a board is a written-down top-N in the
// shared store, swept from who is online rather than queried from the database.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadModules, unloadAllModules } from './moduleLoader.js';
import { clearProvides, useApi } from './registry.js';
import { clearCommands } from '../commands.js';
import { clearAll, emit } from '../hooks.js';
import { drainGameEvents } from '../eventBus.js';
import { createFixture } from '../../sim/simFixture.js';
import { kvDelete, kvKeys } from '../../persistence/kvStore.js';

let sim: ReturnType<typeof createFixture>;

beforeEach(() => {
  clearAll();
  clearCommands();
  clearProvides();
  drainGameEvents();
  for (const key of kvKeys('leaderboard')) kvDelete('leaderboard', key);
  sim = createFixture(0);
  loadModules();
});

afterEach(() => {
  unloadAllModules();
  clearAll();
  clearProvides();
});

type Row = { name: string; score: number; level?: number };

const board = () =>
  useApi<{
    submit: (
      board: string,
      name: string,
      score: number,
      extra?: object,
    ) => boolean;
    top: (board?: string, count?: number) => Row[];
    rankOf: (board: string, name: string) => number;
    boards: () => string[];
    reset: (board?: string) => void;
  }>('leaderboard')!;

describe('the level board', () => {
  it('records a player who leaves, so their row outlives the session', () => {
    const player = sim.addPlayer({ name: 'Ana', level: 12, experience: 400 });

    emit('playerLeave', { player });

    expect(board().top()).toEqual([
      { name: 'Ana', score: 12_000_400, level: 12, experience: 400 },
    ]);
  });

  it('ranks by level first and by experience within it', () => {
    const low = sim.addPlayer({ name: 'Ana', level: 12, experience: 900 });
    const high = sim.addPlayer({ name: 'Bo', level: 13, experience: 0 });
    const tied = sim.addPlayer({ name: 'Cy', level: 12, experience: 950 });

    for (const player of [low, high, tied]) emit('playerLeave', { player });

    expect(
      board()
        .top()
        .map((row) => row.name),
    ).toEqual(['Bo', 'Cy', 'Ana']);
  });

  it('keeps one row per player, updated rather than appended', () => {
    const player = sim.addPlayer({ name: 'Ana', level: 5, experience: 0 });
    emit('playerLeave', { player });

    player.level = 20;
    emit('playerLeave', { player });

    expect(board().top()).toHaveLength(1);
    expect(board().top()[0]!.level).toBe(20);
  });

  it('orders a tie by name, so the board does not reshuffle under it', () => {
    const a = sim.addPlayer({ name: 'Zed', level: 5, experience: 0 });
    const b = sim.addPlayer({ name: 'Ana', level: 5, experience: 0 });

    emit('playerLeave', { player: a });
    emit('playerLeave', { player: b });

    expect(
      board()
        .top()
        .map((row) => row.name),
    ).toEqual(['Ana', 'Zed']);
  });
});

describe('a board a script keeps', () => {
  it('takes any name and score, not only players', () => {
    board().submit('richest', 'Guild of Thieves', 9000);

    expect(board().top('richest')).toEqual([
      { name: 'Guild of Thieves', score: 9000 },
    ]);
  });

  it('refuses a score that is not a number', () => {
    expect(board().submit('richest', 'Ana', NaN)).toBe(false);
    expect(board().submit('richest', '', 10)).toBe(false);
    expect(board().top('richest')).toEqual([]);
  });

  it('answers where a name sits, and zero when it does not', () => {
    board().submit('richest', 'Ana', 10);
    board().submit('richest', 'Bo', 20);

    expect(board().rankOf('richest', 'Bo')).toBe(1);
    expect(board().rankOf('richest', 'Ana')).toBe(2);
    expect(board().rankOf('richest', 'Nobody')).toBe(0);
  });

  it('lists the boards with something in them, level first', () => {
    board().submit('richest', 'Ana', 10);
    emit('playerLeave', {
      player: sim.addPlayer({ name: 'Bo', level: 2, experience: 0 }),
    });

    expect(board().boards()).toEqual(['level', 'richest']);
  });

  it('is dropped whole by reset, which is how a season ends', () => {
    board().submit('richest', 'Ana', 10);

    board().reset('richest');

    expect(board().top('richest')).toEqual([]);
    expect(board().boards()).toEqual([]);
  });
});

describe('the sweep', () => {
  it('puts the asking player on the board before answering them', () => {
    const player = sim.addPlayer({ name: 'Ana', level: 4, experience: 2 });
    expect(board().top()).toEqual([]); // never left, never swept

    emit('customAction', {
      player,
      channel: 'leaderboard:request',
      payload: null,
    });

    expect(board().rankOf('level', 'Ana')).toBe(1);
  });

  it('does not sweep for a board it does not keep', () => {
    const player = sim.addPlayer({ name: 'Ana', level: 4 });
    board().submit('richest', 'Bo', 1);

    emit('customAction', {
      player,
      channel: 'leaderboard:request',
      payload: { board: 'richest' },
    });

    expect(board().top()).toEqual([]);
  });
});

describe('what the client is sent', () => {
  it('carries the ranked rows and the boards to choose from', () => {
    const player = sim.addPlayer({ name: 'Ana', level: 7, experience: 10 });
    emit('playerLeave', { player });
    drainGameEvents();

    emit('customAction', {
      player,
      channel: 'leaderboard:request',
      payload: null,
    });

    const update = drainGameEvents().find(
      (e) => e.type === 'customPlayer' && e.channel === 'leaderboard:update',
    ) as
      | { payload: { board: string; boards: string[]; rows: Row[] } }
      | undefined;
    expect(update?.payload.board).toBe('level');
    expect(update?.payload.boards).toEqual(['level']);
    expect(update?.payload.rows).toEqual([
      { rank: 1, name: 'Ana', score: 7_000_010, level: 7, experience: 10 },
    ]);
  });

  it('sends the board that was asked for', () => {
    const player = sim.addPlayer({ name: 'Ana' });
    board().submit('richest', 'Ana', 5);
    drainGameEvents();

    emit('customAction', {
      player,
      channel: 'leaderboard:request',
      payload: { board: 'richest' },
    });

    const update = drainGameEvents().find(
      (e) => e.type === 'customPlayer' && e.channel === 'leaderboard:update',
    ) as { payload: { board: string } } | undefined;
    expect(update?.payload.board).toBe('richest');
  });
});
