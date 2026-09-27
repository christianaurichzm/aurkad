import { describe, it, expect } from 'vitest';
import { createFixture, tile } from '../../sim/simFixture.js';
import { Direction, Key, PvpMorale } from '../../../shared/types.js';
import { mapPvpMorale, mapAllowsPvp } from '../../../shared/utils.js';

describe('mapPvpMorale', () => {
  it('derives from type when unset (back-compat)', () => {
    expect(mapPvpMorale({ type: 'pvp' })).toBe('no-penalty');
    expect(mapPvpMorale({ type: 'normal' })).toBe('safe');
  });

  it('uses the explicit morale when set', () => {
    expect(mapPvpMorale({ type: 'normal', pvp: 'normal' })).toBe('normal');
    expect(mapAllowsPvp({ type: 'normal', pvp: 'safe' })).toBe(false);
    expect(mapAllowsPvp({ type: 'normal', pvp: 'normal' })).toBe(true);
    expect(mapAllowsPvp({ type: 'normal', pvp: 'no-penalty' })).toBe(true);
  });
});

describe('PvP morale in combat', () => {
  function bobHealthAfterAliceAttacks(morale: PvpMorale): number {
    const sim = createFixture(0);
    sim.map.pvp = morale;
    sim.addPlayer({
      name: 'Alice',
      position: tile(5, 5),
      direction: Direction.Right,
      attack: 20,
    });
    const bob = sim.addPlayer({
      name: 'Bob',
      position: tile(6, 5),
      health: 100,
      maxHealth: 100,
    });

    sim.press('Alice', Key.Control);
    sim.step(1);
    return bob.health;
  }

  it('safe: players cannot damage each other', () => {
    expect(bobHealthAfterAliceAttacks('safe')).toBe(100);
  });

  it('normal: players can damage each other (penalty handled by a PK module)', () => {
    expect(bobHealthAfterAliceAttacks('normal')).toBeLessThan(100);
  });

  it('no-penalty: players can damage each other', () => {
    expect(bobHealthAfterAliceAttacks('no-penalty')).toBeLessThan(100);
  });
});
