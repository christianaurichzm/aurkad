// Exercises the real PK module: killing a player on a 'normal' PvP map
// flags the killer with a red name, which overrides VIP gold through the
// cosmetic resolver's priority.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unloadAllModules } from './moduleLoader.js';
import { loadModulesForTest } from '../../../test/modules.js';
import { clearProvides } from './registry.js';
import { clearCommands } from '../commands.js';
import { clearAll, emit } from '../hooks.js';
import { drainGameEvents } from '../eventBus.js';
import { setCosmetic } from '../../services/player/cosmeticsService.js';
import { createFixture } from '../../sim/simFixture.js';
import { Access } from '../../../shared/types.js';

beforeEach(() => {
  clearAll();
  clearCommands();
  clearProvides();
  drainGameEvents();
  loadModulesForTest('pk');
});

afterEach(() => {
  unloadAllModules();
  clearAll();
  clearProvides();
});

describe('pk module', () => {
  it('flags the killer with a red name on a normal PvP map', () => {
    const sim = createFixture(0);
    sim.map.pvp = 'normal';
    const victim = sim.addPlayer({ name: 'Victim' });
    const killer = sim.addPlayer({ name: 'Killer' });

    emit('playerDeath', { player: victim, killer });

    expect(typeof killer.data?.pkUntil).toBe('number');
    expect(killer.data?.pkCount).toBe(1);
    expect(killer.nameColor).toBe('red');
  });

  it('does not flag on a no-penalty map', () => {
    const sim = createFixture(0);
    sim.map.pvp = 'no-penalty';
    const victim = sim.addPlayer({ name: 'Victim' });
    const killer = sim.addPlayer({ name: 'Killer' });

    emit('playerDeath', { player: victim, killer });

    expect(killer.data?.pkUntil).toBeUndefined();
    expect(killer.nameColor).toBeUndefined();
  });

  it('PK red overrides VIP gold (cosmetic priority)', () => {
    const sim = createFixture(0);
    sim.map.pvp = 'normal';
    const victim = sim.addPlayer({ name: 'Victim' });
    const killer = sim.addPlayer({ name: 'Killer' });

    setCosmetic(killer, 'nameColor', 'vip', 'gold', 0); // VIP makes the name gold
    expect(killer.nameColor).toBe('gold');

    emit('playerDeath', { player: victim, killer }); // becomes a PK

    expect(killer.nameColor).toBe('red'); // PK (priority 100) wins
  });

  it('never flags an admin', () => {
    const sim = createFixture(0);
    sim.map.pvp = 'normal';
    const victim = sim.addPlayer({ name: 'Victim' });
    const admin = sim.addPlayer({ name: 'Admin', access: Access.ADMIN });

    emit('playerDeath', { player: victim, killer: admin });

    expect(admin.data?.pkUntil).toBeUndefined();
    expect(admin.nameColor).toBeUndefined();
  });

  it('ignores deaths with no player killer (traps, falls)', () => {
    const sim = createFixture(0);
    sim.map.pvp = 'normal';
    const victim = sim.addPlayer({ name: 'Victim' });

    emit('playerDeath', { player: victim });

    expect(victim.data?.pkUntil).toBeUndefined();
  });
});
