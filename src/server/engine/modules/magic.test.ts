// Exercises the real shipped magic module (modules/magic) end to end: casting
// via the spell:cast custom action applies effects through dealDamage and
// healPlayer and spends mana, bounded by cooldowns.
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  onTestFinished,
  vi,
} from 'vitest';
import { unloadAllModules } from './moduleLoader.js';
import { loadModulesForTest } from '../../../test/modules.js';
import { useApi, clearProvides } from './registry.js';
import { clearCommands, handleChatCommand } from '../commands.js';
import { clearAll, emit } from '../hooks.js';
import { drainGameEvents } from '../eventBus.js';
import { clearKvStoreMemory } from '../../persistence/kvStore.js';
import { handleCustomAction } from '../../services/comms/customEventService.js';
import { createFixture, tile } from '../../sim/simFixture.js';
import { gameConfig } from '../../gameConfig.js';
import { config } from '../../config.js';
import { useItem } from '../../services/economy/inventoryService.js';
import { items } from '../../services/content/itemService.js';
import { registeredBehaviors } from '../scripting/entityScripts.js';
import type { PlayerServer, Spell } from '../../../shared/types.js';
import { TILE_SIZE } from '../../../shared/constants.js';

// What the module reads back as the database's spells. Empty, it seeds and
// casts its built-ins, and the seed lands in `saved` with the id the database
// would keep: the one it was given, or the next of a counter that spells
// deleted earlier can have taken anywhere.
const dbSpells: Spell[] = [];
const saved: Spell[] = [];
vi.mock('../../services/content/spellService.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAllSpells: () => dbSpells,
  createOrUpdateSpell: (spell: Spell) => {
    saved.push({ ...spell, id: spell.id ?? 40 + saved.length });
    return Promise.resolve(saved.at(-1));
  },
}));

// The built-ins, by the ids the module seeds them under.
const BLAST = '1';
const HEAL = '2';

interface MagicApi {
  defineSpell: (spell: { id: string; name: string }) => void;
  cast: (player: PlayerServer, spellId: string) => boolean;
  setSpells: (player: PlayerServer, ids?: string[]) => void;
  learn: (player: PlayerServer, spellId: string) => boolean;
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
  saved.length = 0;
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

    castVia('spell:cast', 'Alice', BLAST);

    expect(goblin.health).toBeLessThan(30); // took blast damage
    expect(caster.data?.mana).toBe(70); // 100 - 30 cost
  });

  it('blast spares the npcs a sword could not strike', () => {
    const sim = createFixture(0);
    sim.addPlayer({ name: 'Alice', position: tile(5, 5) });
    const spared = (
      ['friendly', 'neutral', 'shopkeeper', 'guard'] as const
    ).map((behavior, i) =>
      sim.addNpc({
        behavior,
        position: tile(4 + i, 6),
        maxHealth: 30,
        health: 30,
      }),
    );
    const orc = sim.addNpc({
      behavior: 'hostile',
      position: tile(6, 5),
      maxHealth: 30,
      health: 30,
    });
    sim.step(1);
    drainGameEvents();

    castVia('spell:cast', 'Alice', BLAST);

    expect(spared.map((npc) => npc.health)).toEqual([30, 30, 30, 30]);
    expect(orc.health).toBeLessThan(30);
    const visuals = drainGameEvents().filter(
      (e) => e.type === 'customMap' && e.channel === 'spell:visual',
    );
    expect(visuals).toHaveLength(1);
  });

  it('bursts over the middle of an npc three tiles wide', () => {
    const sim = createFixture(0);
    sim.addPlayer({ name: 'Alice', position: tile(5, 5) });
    sim.addNpc({
      behavior: 'aggressive',
      position: tile(6, 4),
      width: 3 * TILE_SIZE,
      height: 3 * TILE_SIZE,
    });
    sim.step(1);
    drainGameEvents();

    castVia('spell:cast', 'Alice', BLAST);

    const visual = drainGameEvents().find(
      (e) => e.type === 'customMap' && e.channel === 'spell:visual',
    );
    expect(visual?.type === 'customMap' && visual.payload).toMatchObject(
      tile(7, 5),
    );
  });

  it('heal restores the caster and spends mana', () => {
    const sim = createFixture(0);
    const caster = sim.addPlayer({ name: 'Alice', health: 40, maxHealth: 100 });
    sim.step(1);

    castVia('spell:cast', 'Alice', HEAL);

    expect(caster.health).toBe(100);
    expect(caster.data?.mana).toBe(75); // 100 - 25 cost
  });

  it('a second cast within the cooldown is blocked', () => {
    const sim = createFixture(0);
    const caster = sim.addPlayer({ name: 'Alice', health: 10, maxHealth: 100 });
    sim.step(1);

    castVia('spell:cast', 'Alice', HEAL);
    expect(caster.data?.mana).toBe(75);

    caster.health = 10;
    castVia('spell:cast', 'Alice', HEAL); // still on cooldown

    expect(caster.health).toBe(10); // not healed again
    expect(caster.data?.mana).toBe(75); // no extra mana spent
  });

  it('refuses to cast without enough mana', () => {
    const sim = createFixture(0);
    const caster = sim.addPlayer({ name: 'Alice', health: 40, maxHealth: 100 });
    caster.data = { mana: 5 };
    sim.step(1);

    castVia('spell:cast', 'Alice', HEAL);

    expect(caster.health).toBe(40); // not healed
    expect(caster.data?.mana).toBe(5); // unchanged
  });

  it('refuses to cast when the mana it costs cannot be stored', () => {
    const sim = createFixture(0);
    const caster = sim.addPlayer({ name: 'Alice', health: 40, maxHealth: 100 });
    // A bag at its key limit, with no mana key yet to update.
    caster.data = Object.fromEntries(
      Array.from({ length: config.scriptData.maxKeys }, (_, i) => [`k${i}`, 0]),
    );
    sim.step(1);

    castVia('spell:cast', 'Alice', HEAL);

    expect(caster.health).toBe(40);
  });

  it('gives the mana back when the spell throws', () => {
    const sim = createFixture(0);
    const caster = sim.addPlayer({ name: 'Alice' });
    const magic = useApi<MagicApi>('magic')!;
    magic.defineSpell({
      id: 'broken',
      name: 'Broken',
      cost: 10,
      cast: () => {
        throw new Error('broken spell');
      },
    } as never);

    expect(magic.cast(caster, 'broken')).toBe(false);
    expect(caster.data?.mana ?? 100).toBe(100);
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

  // A spell list, a tome or startingSpells names a spell by id, and from the
  // second boot on the built-ins are loaded from the database.
  it('casts its built-ins under the ids the next boot loads them with', async () => {
    const sim = createFixture(0);
    sim.addPlayer({ name: 'Alice' });
    const castable = () => {
      drainGameEvents();
      handleCustomAction({
        type: 'custom',
        username: 'Alice',
        channel: 'magic:request',
      });
      const ev = drainGameEvents().find(
        (e) => e.type === 'customPlayer' && e.channel === 'magic:update',
      ) as { payload: { spells: { id: string }[] } } | undefined;
      return ev?.payload.spells.map((s) => s.id);
    };
    const firstBoot = castable();
    await vi.waitFor(() => expect(saved).toHaveLength(2));

    dbSpells.push(...saved);
    unloadAllModules();
    clearAll();
    clearProvides();
    loadModulesForTest('magic');

    expect(castable()).toEqual(firstBoot);
  });

  // Classes: with no list a player casts every spell.
  it('a player with a spell list sees and casts only those', () => {
    const sim = createFixture(0);
    const caster = sim.addPlayer({ name: 'Alice', health: 40, maxHealth: 100 });
    sim.step(1);
    drainGameEvents();

    useApi<MagicApi>('magic')!.setSpells(caster, [BLAST]);
    const ev = drainGameEvents().find(
      (e) => e.type === 'customPlayer' && e.channel === 'magic:update',
    ) as { payload: { spells: { id: string }[] } } | undefined;
    castVia('spell:cast', 'Alice', HEAL);

    expect(ev?.payload.spells.map((s) => s.id)).toEqual([BLAST]);
    expect(caster.health).toBe(40); // not one of hers
    expect(caster.data?.mana).toBeUndefined(); // nothing spent

    useApi<MagicApi>('magic')!.setSpells(caster, undefined);
    castVia('spell:cast', 'Alice', HEAL);

    expect(caster.health).toBe(100);
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
    expect(byId[HEAL]).toBe(true);
    expect(byId[BLAST]).toBe(false);
  });

  it('gives each slot its icon, or a frame a third into the effect', () => {
    const base = {
      description: 'Hurts.',
      mpCost: 10,
      damage: 5,
      heal: 0,
      cooldownMs: 0,
      target: 'enemies',
      visualTarget: 'targets',
    } as const;
    dbSpells.push(
      { ...base, id: 1, name: 'Chosen', sprite: 144, frames: 12, icon: 7 },
      { ...base, id: 2, name: 'Effect', sprite: 144, frames: 12, icon: null },
      { ...base, id: 3, name: 'Still', sprite: 1, frames: 1 },
    );
    unloadAllModules();
    loadModulesForTest('magic');
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
    ) as { payload: { spells: { icon?: number; description: string }[] } };
    expect(ev.payload.spells.map((s) => s.icon)).toEqual([7, 148, 1]);
    expect(ev.payload.spells[0]?.description).toBe('Hurts.');
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

  it('regenerates the same mana per second at another tick rate', () => {
    const gameLoop = config.gameLoop as { tickRate: number };
    const rate = gameLoop.tickRate;
    gameLoop.tickRate = 10;
    onTestFinished(() => {
      gameLoop.tickRate = rate;
    });
    unloadAllModules();
    loadModulesForTest('magic');
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice', data: { mana: 50 } });

    sim.step(20); // two seconds

    expect(alice.data?.mana).toBe(60);
  });
});

describe('learning spells', () => {
  type DialogRef = (ctx: { player: PlayerServer; arg: string }) => unknown;
  const ref = (name: string) => useApi<DialogRef>(name)!;
  const said = () =>
    drainGameEvents().flatMap((e) =>
      e.type === 'chatPlayer' ? [e.payload.message] : [],
    );

  it('starts a character with no list of their own on the configured spells', () => {
    const before = gameConfig.modules['magic'];
    unloadAllModules();
    clearAll();
    clearProvides();
    gameConfig.modules['magic'] = {
      enabled: true,
      config: { startingSpells: [HEAL] },
    };
    try {
      loadModulesForTest('magic');
      const sim = createFixture(0);
      const fresh = sim.addPlayer({ name: 'Alice' });
      const taught = sim.addPlayer({
        name: 'Bob',
        data: { spells: [BLAST, HEAL] },
      });

      emit('playerJoin', { player: fresh });
      emit('playerJoin', { player: taught });

      expect(fresh.data?.spells).toEqual([HEAL]);
      expect(taught.data?.spells).toEqual([BLAST, HEAL]);
    } finally {
      gameConfig.modules['magic'] = before!;
    }
  });

  it('teaches from a dialog, whose offer goes once the spell is known', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });
    useApi<MagicApi>('magic')!.setSpells(alice, [BLAST]);
    drainGameEvents();
    const ctx = { player: alice, arg: HEAL };

    expect(ref('dialogCondition.lacksSpell')(ctx)).toBe(true);
    ref('dialogAction.learnSpell')(ctx);

    expect(alice.data?.spells).toEqual([BLAST, HEAL]);
    expect(said()).toEqual(['You learned Heal.']);
    expect(ref('dialogCondition.lacksSpell')(ctx)).toBe(false);
    expect(ref('dialogCondition.knowsSpell')(ctx)).toBe(true);
    // A dialog naming a spell that is gone stops rather than saying it taught.
    expect(() =>
      ref('dialogAction.learnSpell')({ player: alice, arg: 'gone' }),
    ).toThrow();
  });

  it('offers a tome a spell a script defines after the module loaded', () => {
    useApi<MagicApi>('magic')!.defineSpell({ id: 'ember', name: 'Ember' });

    const [spell] = registeredBehaviors().get('learnSpell')!.params;
    expect(spell).toMatchObject({
      options: expect.arrayContaining([HEAL, 'ember']),
      optionLabels: expect.arrayContaining(['Ember']),
    });
  });

  it('teaches from a tome, kept by a reader who knows the spell already', () => {
    const sim = createFixture(0);
    items.set(90, {
      id: 90,
      name: 'Tome of Healing',
      description: '',
      sprite: 0,
      type: 'consumable',
      scriptId: 'learnSpell',
      scriptParams: { spell: HEAL },
    });
    const alice = sim.addPlayer({
      name: 'Alice',
      inventory: { items: [{ item: 90, quantity: 2 }], maxCapacity: 10 },
    });
    useApi<MagicApi>('magic')!.setSpells(alice, [BLAST]);
    drainGameEvents();

    try {
      expect(useItem('Alice', 90)).toBe(true);
      expect(useItem('Alice', 90)).toBe(false);

      expect(alice.data?.spells).toEqual([BLAST, HEAL]);
      expect(alice.inventory.items).toEqual([{ item: 90, quantity: 1 }]);
      expect(said()).toEqual(['You learned Heal.', 'You already know Heal.']);
    } finally {
      items.delete(90);
    }
  });

  it('keeps the tome when the longer spell list cannot be stored', () => {
    const sim = createFixture(0);
    items.set(90, {
      id: 90,
      name: 'Tome of Healing',
      description: '',
      sprite: 0,
      type: 'consumable',
      scriptId: 'learnSpell',
      scriptParams: { spell: HEAL },
    });
    const alice = sim.addPlayer({
      name: 'Alice',
      inventory: { items: [{ item: 90, quantity: 1 }], maxCapacity: 10 },
    });
    useApi<MagicApi>('magic')!.setSpells(alice, [BLAST]);
    drainGameEvents();
    const limits = config.scriptData as { maxValueBytes: number };
    const was = limits.maxValueBytes;
    limits.maxValueBytes = JSON.stringify([BLAST]).length;

    try {
      expect(useItem('Alice', 90)).toBe(false);

      expect(alice.data?.spells).toEqual([BLAST]);
      expect(alice.inventory.items).toEqual([{ item: 90, quantity: 1 }]);
      expect(said()).toEqual([]);
    } finally {
      limits.maxValueBytes = was;
      items.delete(90);
    }
  });
});
