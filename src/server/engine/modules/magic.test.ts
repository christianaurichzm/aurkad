// Exercises the real shipped magic module (modules/magic) end to end: casting
// via the spell:cast custom action applies effects through dealDamage and
// healPlayer and spends mana, bounded by cooldowns.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { unloadAllModules } from './moduleLoader.js';
import { loadModulesForTest } from '../../../test/modules.js';
import { useApi, clearProvides } from './registry.js';
import { clearCommands, handleChatCommand } from '../commands.js';
import { clearAll } from '../hooks.js';
import { drainGameEvents } from '../eventBus.js';
import { clearKvStoreMemory } from '../../persistence/kvStore.js';
import { handleCustomAction } from '../../services/comms/customEventService.js';
import { createFixture, tile } from '../../sim/simFixture.js';
import type { PlayerServer, Spell } from '../../../shared/types.js';

// What the module reads back as the database's spells. Empty, it seeds and
// casts its built-ins.
const dbSpells: Spell[] = [];
vi.mock('../../services/content/spellService.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAllSpells: () => dbSpells,
}));

interface MagicApi {
  cast: (player: PlayerServer, spellId: string) => boolean;
}

function castVia(action: string, username: string, id: string) {
  handleCustomAction({
    type: 'custom',
    username,
    channel: action,
    payload: { id },
  });
}

beforeEach(() => {
  clearAll();
  clearCommands();
  clearProvides();
  clearKvStoreMemory();
  drainGameEvents();
  loadModulesForTest('magic');
});

afterEach(() => {
  dbSpells.length = 0;
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

    handleCustomAction({
      type: 'custom',
      username: 'Alice',
      channel: 'magic:request',
    });

    const ev = drainGameEvents().find(
      (e) => e.type === 'customPlayer' && e.channel === 'magic:update',
    ) as { payload: { mana: number; spells: unknown[] } } | undefined;
    expect(ev?.payload.mana).toBe(100);
    expect(ev?.payload.spells.length).toBe(2);
  });

  // The hotbar paints a friendly slot differently, and the only place that
  // knows which spells those are is the definition the cast was built from.
  it('marks a spell that acts on the caster as friendly', () => {
    const sim = createFixture(0);
    sim.addPlayer({ name: 'Alice' });
    drainGameEvents();

    handleCustomAction({
      type: 'custom',
      username: 'Alice',
      channel: 'magic:request',
    });

    const ev = drainGameEvents().find(
      (e) => e.type === 'customPlayer' && e.channel === 'magic:update',
    ) as
      { payload: { spells: { id: string; friendly: boolean }[] } } | undefined;
    const byId = Object.fromEntries(
      (ev?.payload.spells ?? []).map((s) => [s.id, s.friendly]),
    );
    expect(byId['heal']).toBe(true);
    expect(byId['blast']).toBe(false);
  });

  const groups = {
    party: (alice: PlayerServer, bob: PlayerServer) => {
      const party = useApi<{
        create: (p: PlayerServer) => void;
        invite: (p: PlayerServer, name: string) => string;
        accept: (p: PlayerServer, leader: string) => string;
      }>('party')!;
      party.create(alice);
      party.invite(alice, 'Bob');
      party.accept(bob, 'Alice');
    },
    guild: (alice: PlayerServer, bob: PlayerServer) => {
      handleChatCommand(alice, '/guild create Dragons');
      handleChatCommand(bob, '/guild join Dragons');
    },
  };

  it.each(['party', 'guild'] as const)(
    'a %s spell heals the group in range and no one else',
    (target) => {
      dbSpells.push({
        id: 1,
        name: 'Mend',
        description: '',
        sprite: 0,
        frames: 1,
        mpCost: 10,
        damage: 0,
        heal: 20,
        cooldownMs: 0,
        target,
        visualTarget: 'targets',
      });
      unloadAllModules();
      loadModulesForTest('magic', target);

      const sim = createFixture(0);
      const alice = sim.addPlayer({
        name: 'Alice',
        position: tile(5, 5),
        health: 90,
        maxHealth: 100,
      });
      const bob = sim.addPlayer({
        name: 'Bob',
        position: tile(6, 5),
        health: 40,
        maxHealth: 100,
      });
      const carol = sim.addPlayer({
        name: 'Carol',
        position: tile(5, 6),
        health: 40,
        maxHealth: 100,
      });
      sim.step(1);
      groups[target](alice, bob);

      castVia('spell:cast', 'Alice', '1');

      expect(alice.health).toBe(100); // capped at max
      expect(bob.health).toBe(60);
      expect(carol.health).toBe(40); // not in the group
    },
  );
});
