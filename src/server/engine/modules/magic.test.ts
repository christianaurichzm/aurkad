// Exercises the real shipped magic module (modules/magic) end to end: casting
// via the spell:cast custom action applies effects through dealDamage and
// healPlayer and spends mana, bounded by cooldowns.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadModules, unloadAllModules } from './moduleLoader.js';
import { useApi, clearProvides } from './registry.js';
import { clearCommands } from '../commands.js';
import { clearAll } from '../hooks.js';
import { drainGameEvents } from '../eventBus.js';
import { handleCustomAction } from '../../services/customEventService.js';
import { createFixture, tile } from '../../sim/simFixture.js';
import type { PlayerServer } from '../../../shared/types.js';

interface MagicApi {
  cast: (player: PlayerServer, spellId: string) => boolean;
}

function castVia(action: string, username: string, id: string) {
  handleCustomAction({ type: 'custom', username, channel: action, payload: { id } });
}

beforeEach(() => {
  clearAll();
  clearCommands();
  clearProvides();
  drainGameEvents();
  loadModules(); // real modules/ (magic enabled in game.json)
});

afterEach(() => {
  unloadAllModules();
  clearAll();
  clearProvides();
});

describe('magic module', () => {
  it('provides a magic API', () => {
    const magic = useApi<MagicApi>('magic');
    expect(magic?.cast).toBeTypeOf('function');
  });

  it('blast damages nearby NPCs and spends mana (via spell:cast action)', () => {
    const sim = createFixture(0);
    const caster = sim.addPlayer({ name: 'Alice', position: tile(5, 5) });
    const goblin = sim.addNpc({
      name: 'Goblin',
      behavior: 'aggressive',
      position: tile(6, 5),
      maxHealth: 30,
      health: 30,
    });
    sim.step(1); // build the spatial index

    castVia('spell:cast', 'Alice', 'blast');

    expect(goblin.health).toBeLessThan(30); // took blast damage
    expect(caster.data?.mana).toBe(70); // 100 - 30 cost
  });

  it('heal restores the caster and spends mana', () => {
    const sim = createFixture(0);
    const caster = sim.addPlayer({ name: 'Alice', health: 40, maxHealth: 100 });
    sim.step(1);

    castVia('spell:cast', 'Alice', 'heal');

    expect(caster.health).toBe(100);
    expect(caster.data?.mana).toBe(75); // 100 - 25 cost
  });

  it('a second cast within the cooldown is blocked', () => {
    const sim = createFixture(0);
    const caster = sim.addPlayer({ name: 'Alice', health: 10, maxHealth: 100 });
    sim.step(1);

    castVia('spell:cast', 'Alice', 'heal');
    expect(caster.data?.mana).toBe(75);

    caster.health = 10;
    castVia('spell:cast', 'Alice', 'heal'); // still on cooldown

    expect(caster.health).toBe(10); // not healed again
    expect(caster.data?.mana).toBe(75); // no extra mana spent
  });

  it('refuses to cast without enough mana', () => {
    const sim = createFixture(0);
    const caster = sim.addPlayer({ name: 'Alice', health: 40, maxHealth: 100 });
    caster.data = { mana: 5 };
    sim.step(1);

    castVia('spell:cast', 'Alice', 'heal');

    expect(caster.health).toBe(40); // not healed
    expect(caster.data?.mana).toBe(5); // unchanged
  });

  it('pushes a magic:update to the client on request', () => {
    const sim = createFixture(0);
    sim.addPlayer({ name: 'Alice' });
    drainGameEvents();

    handleCustomAction({ type: 'custom', username: 'Alice', channel: 'magic:request' });

    const ev = drainGameEvents().find(
      (e) => e.type === 'customPlayer' && e.channel === 'magic:update',
    ) as { payload: { mana: number; spells: unknown[] } } | undefined;
    expect(ev?.payload.mana).toBe(100);
    expect(ev?.payload.spells.length).toBe(2);
  });
});
