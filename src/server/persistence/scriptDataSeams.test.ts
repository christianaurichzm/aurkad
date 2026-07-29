/**
 * The limits as a script meets them: the two write sites enforce dataLimits
 * and report back, since a refusal a script cannot see is a silent failure.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runInSandbox } from '../engine/scripting/sandbox.js';
import { clearAll, emit } from '../engine/hooks.js';
import { createFixture } from '../sim/simFixture.js';
import { kvGet, kvSet, clearKvStoreMemory } from './kvStore.js';
import { config } from '../config.js';

const results = vi.hoisted(() => ({ log: [] as unknown[] }));

beforeEach(() => {
  clearAll();
  clearKvStoreMemory();
  results.log = [];
});

function script(code: string) {
  return runInSandbox(code, 'data.js', {
    record: (value: unknown) => results.log.push(value),
    bigValue: 'x'.repeat(config.scriptData.maxValueBytes + 1),
  });
}

describe('setPlayerData', () => {
  it('stores a normal value and reports success', () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice' });
    const handle = script(`
      on('playerJoin', ({ player }) => {
        record(setPlayerData(player, 'quest', { step: 3 }));
        record(getPlayerData(player, 'quest').step);
      });
    `);

    emit('playerJoin', { player });

    expect(results.log).toEqual([true, 3]);
    handle.cleanup();
  });

  // An oversized write would make the player document unsaveable for good,
  // so it is refused and the script is told.
  it('refuses an oversized value and leaves the data untouched', () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice' });
    const handle = script(`
      on('playerJoin', ({ player }) => {
        record(setPlayerData(player, 'huge', bigValue));
        record(getPlayerData(player, 'huge'));
      });
    `);

    emit('playerJoin', { player });

    expect(results.log).toEqual([false, undefined]);
    handle.cleanup();
  });

  it('refuses a circular value instead of letting the save throw later', () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice' });
    const handle = script(`
      on('playerJoin', ({ player }) => {
        const loop = { name: 'loop' };
        loop.self = loop;
        record(setPlayerData(player, 'loop', loop));
      });
    `);

    emit('playerJoin', { player });

    expect(results.log).toEqual([false]);
    expect(player.data?.['loop']).toBeUndefined();
    handle.cleanup();
  });

  it('refuses a new key once the key cap is reached', () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice' });
    const handle = script(`
      on('playerJoin', ({ player }) => {
        let stored = 0;
        for (let i = 0; i < ${config.scriptData.maxKeys + 5}; i++) {
          if (setPlayerData(player, 'k' + i, i)) stored++;
        }
        record(stored);
      });
    `);

    emit('playerJoin', { player });

    expect(results.log).toEqual([config.scriptData.maxKeys]);
    handle.cleanup();
  });

  // Without this a script that filled the bag could never clear it.
  it('still lets an existing key be overwritten at the cap', () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice' });
    const handle = script(`
      on('playerJoin', ({ player }) => {
        for (let i = 0; i < ${config.scriptData.maxKeys}; i++) {
          setPlayerData(player, 'k' + i, 'original');
        }
        record(setPlayerData(player, 'k0', 'cleared'));
        record(getPlayerData(player, 'k0'));
      });
    `);

    emit('playerJoin', { player });

    expect(results.log).toEqual([true, 'cleared']);
    handle.cleanup();
  });

  // The idiom for clearing, as the guild module leaves a guild. undefined
  // never persisted as a value, and it is the way out of the key limit.
  it('treats undefined as clearing the key', () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice' });
    const handle = runInSandbox(
      `
      on('playerJoin', () => {
        setPlayerData(target, 'guild', 'Dragons');
        record(getPlayerData(target, 'guild'));
        record(setPlayerData(target, 'guild', undefined));
        record(getPlayerData(target, 'guild'));
      });
    `,
      'clear.js',
      { target: player, record: (v: unknown) => results.log.push(v) },
    );

    emit('playerJoin', { player });

    expect(results.log).toEqual(['Dragons', true, undefined]);
    expect('guild' in (player.data ?? {})).toBe(false);
    handle.cleanup();
  });

  it('lets clearing free a slot when at the key cap', () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice' });
    const handle = runInSandbox(
      `
      on('playerJoin', () => {
        for (let i = 0; i < ${config.scriptData.maxKeys}; i++) {
          setPlayerData(target, 'k' + i, i);
        }
        record(setPlayerData(target, 'extra', 1));
        setPlayerData(target, 'k0', undefined);
        record(setPlayerData(target, 'extra', 1));
      });
    `,
      'free.js',
      { target: player, record: (v: unknown) => results.log.push(v) },
    );

    emit('playerJoin', { player });

    expect(results.log).toEqual([false, true]);
    handle.cleanup();
  });

  // A read hands back a copy: given the live object, this mutation would grow
  // the stored value without the write check ever getting a say.
  it('does not let a mutation through a read reach storage', () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice' });
    const handle = runInSandbox(
      `
      on('playerJoin', () => {
        setPlayerData(target, 'list', [1, 2]);
        const borrowed = getPlayerData(target, 'list');
        borrowed.push(3);
        record(getPlayerData(target, 'list').length);
      });
    `,
      'alias.js',
      { target: player, record: (v: unknown) => results.log.push(v) },
    );

    emit('playerJoin', { player });

    expect(results.log).toEqual([2]);
    handle.cleanup();
  });

  // The shape that causes this in real code: append to a value every tick
  // and write it back.
  it('stops a value that grows every tick before it can break the save', () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice' });
    const handle = runInSandbox(
      `
      on('tick', ({ tick }) => {
        const log = getPlayerData(target, 'log') || [];
        log.push('entry-' + tick + '-' + 'y'.repeat(500));
        setPlayerData(target, 'log', log);
      });
    `,
      'grow.js',
      { target: player },
    );

    for (let tick = 0; tick < 400; tick++) emit('tick', { tick });

    const stored = JSON.stringify(player.data?.['log'] ?? []);
    expect(Buffer.byteLength(stored)).toBeLessThanOrEqual(
      config.scriptData.maxValueBytes,
    );
    // It stored something before hitting the wall: the cap bounds the
    // feature rather than disabling it.
    expect(Buffer.byteLength(stored)).toBeGreaterThan(1000);
    handle.cleanup();
  });
});

describe('the shared store', () => {
  it('stores a normal value and reports success', () => {
    expect(kvSet('guild', 'alpha', { members: ['a', 'b'] })).toBe(true);
    expect(kvGet('guild', 'alpha')).toEqual({ members: ['a', 'b'] });
  });

  it('refuses an oversized value and keeps the old one', () => {
    kvSet('guild', 'alpha', 'original');

    expect(
      kvSet('guild', 'alpha', 'x'.repeat(config.scriptData.maxValueBytes + 1)),
    ).toBe(false);
    expect(kvGet('guild', 'alpha')).toBe('original');
  });

  it('refuses a circular value', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;

    expect(kvSet('guild', 'loop', circular)).toBe(false);
    expect(kvGet('guild', 'loop')).toBeUndefined();
  });

  it('clears an entry when handed undefined', () => {
    kvSet('guild', 'alpha', 'original');

    expect(kvSet('guild', 'alpha', undefined)).toBe(true);
    expect(kvGet('guild', 'alpha')).toBeUndefined();
  });

  it('reports back through the script api', () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice' });
    const handle = script(`
      on('playerJoin', () => {
        record(store.set('s', 'ok', 1));
        record(store.set('s', 'bad', bigValue));
      });
    `);

    emit('playerJoin', { player });

    expect(results.log).toEqual([true, false]);
    handle.cleanup();
  });
});
