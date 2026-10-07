// Exercises the real PK module: killing a player on a 'normal' PvP map flags
// the killer with a red name, and PK red overrides VIP gold via the cosmetic
// resolver priority. The flag is what makes a player fair game anywhere.
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  onTestFinished,
} from 'vitest';
import { unloadAllModules } from './moduleLoader.js';
import { loadModulesForTest } from '../../../test/modules.js';
import { clearProvides } from './registry.js';
import { clearCommands } from '../commands.js';
import { clearAll, emit } from '../hooks.js';
import { drainGameEvents } from '../eventBus.js';
import { setCosmetic } from '../../services/player/cosmeticsService.js';
import { createFixture, tile } from '../../sim/simFixture.js';
import { unregisterPlayer } from '../../sim/world.js';
import { enterWorld } from '../../services/player/playerService.js';
import { gameConfig } from '../../gameConfig.js';
import {
  Access,
  Direction,
  Key,
  type PvpMorale,
} from '../../../shared/types.js';

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

    expect(killer.data?.pkLeftMs).toBeGreaterThan(0);
    expect(killer.data?.pkCount).toBe(1);
    expect(killer.nameColor).toBe('red');
  });

  it('does not flag on a no-penalty map', () => {
    const sim = createFixture(0);
    sim.map.pvp = 'no-penalty';
    const victim = sim.addPlayer({ name: 'Victim' });
    const killer = sim.addPlayer({ name: 'Killer' });

    emit('playerDeath', { player: victim, killer });

    expect(killer.data?.pkLeftMs).toBeUndefined();
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

    expect(admin.data?.pkLeftMs).toBeUndefined();
    expect(admin.nameColor).toBeUndefined();
  });

  it('ignores deaths with no player killer (traps, falls)', () => {
    const sim = createFixture(0);
    sim.map.pvp = 'normal';
    const victim = sim.addPlayer({ name: 'Victim' });

    emit('playerDeath', { player: victim });

    expect(victim.data?.pkLeftMs).toBeUndefined();
  });
});

describe('who may hit whom', () => {
  const FLAGGED = { pkLeftMs: 60_000 };

  /** Whether Alice's swing lands on Bob, standing on the tile she faces. */
  function lands(morale: PvpMorale, pk: { alice?: boolean; bob?: boolean }) {
    const sim = createFixture(0);
    sim.map.pvp = morale;
    sim.addPlayer({
      name: 'Alice',
      position: tile(5, 5),
      direction: Direction.Right,
      attack: 20,
      data: pk.alice ? { ...FLAGGED } : undefined,
    });
    const bob = sim.addPlayer({
      name: 'Bob',
      position: tile(6, 5),
      health: 100,
      maxHealth: 100,
      data: pk.bob ? { ...FLAGGED } : undefined,
    });

    sim.press('Alice', Key.Control);
    sim.step(1);
    return bob.health < 100;
  }

  it('opens a PK to anyone on a map without PvP', () => {
    expect(lands('safe', { bob: true })).toBe(true);
  });

  it('keeps a PK from hitting someone who is not one there', () => {
    expect(lands('safe', { alice: true })).toBe(false);
  });

  it('lets one PK hit another there', () => {
    expect(lands('safe', { alice: true, bob: true })).toBe(true);
  });

  it('leaves everyone else alone there', () => {
    expect(lands('safe', {})).toBe(false);
  });

  it('lets a PK hit anyone on a PvP map', () => {
    expect(lands('normal', { alice: true })).toBe(true);
  });

  it('does not flag whoever kills a PK', () => {
    const sim = createFixture(0);
    sim.map.pvp = 'normal';
    const victim = sim.addPlayer({ name: 'Victim', data: { ...FLAGGED } });
    const hunter = sim.addPlayer({ name: 'Hunter' });

    emit('playerDeath', { player: victim, killer: hunter });

    expect(hunter.data?.pkLeftMs).toBeUndefined();
  });
});

describe('the flag', () => {
  it('runs down only while the player is in the game', () => {
    // Two sweeps' worth, so one sweep leaves half of it.
    unloadAllModules();
    clearAll();
    clearProvides();
    const pk = gameConfig.modules.pk;
    gameConfig.modules.pk = { ...pk, config: { flagMinutes: 10 / 60 } };
    onTestFinished(() => {
      if (pk) gameConfig.modules.pk = pk;
      else delete gameConfig.modules.pk;
    });
    loadModulesForTest('pk');
    const sim = createFixture(0);
    sim.map.pvp = 'normal';
    const killer = sim.addPlayer({ name: 'Killer' });
    emit('playerDeath', { player: sim.addPlayer({ name: 'Victim' }), killer });

    sim.step(100);
    expect(killer.data?.pkLeftMs).toBe(5_000);

    // Logged out: nothing counts.
    unregisterPlayer(killer.id);
    delete sim.map.players[killer.id];
    sim.step(1_000);
    expect(killer.data?.pkLeftMs).toBe(5_000);

    enterWorld(killer);
    expect(killer.nameColor).toBe('red');
    sim.step(100);
    expect(killer.data?.pkLeftMs).toBeUndefined();
    expect(killer.nameColor).toBeUndefined();
  });

  it('takes over a flag saved as the time it ends', () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({
      name: 'Returning',
      data: { pkUntil: Date.now() + 60_000 },
    });

    emit('playerJoin', { player });

    expect(player.data?.pkUntil).toBeUndefined();
    expect(player.data?.pkLeftMs).toBeGreaterThan(50_000);
    expect(player.data?.pkLeftMs).toBeLessThanOrEqual(60_000);
    expect(player.nameColor).toBe('red');
  });
});
