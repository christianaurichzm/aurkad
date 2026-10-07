import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import fc from 'fast-check';
import path from 'node:path';
import {
  CharacterAction,
  Direction,
  Key,
  MapStateServer,
  PlayerServer,
  Position,
  Tile,
} from '../../shared/types.js';
import { resetClock, advanceTick } from './clock.js';
import { seedRng } from './rng.js';
import { players, playersByName, runtimeState } from './state.js';
import { registerPlayer, getPlayerByName } from './world.js';
import {
  pressedKeysMap,
  handleKeyAction,
  processMovementIntent,
  processMovementCompletion,
} from '../services/world/movementService.js';
import type { ClientAction } from '../engine/actions.js';
import { createFixture, tile } from './simFixture.js';
import { loadModulesForTest } from '../../test/modules.js';
import { unloadAllModules } from '../engine/modules/moduleLoader.js';
import { clearProvides } from '../engine/modules/registry.js';
import { clearCommands } from '../engine/commands.js';
import { clearAll } from '../engine/hooks.js';
import { drainGameEvents } from '../engine/eventBus.js';
import { clearKvStoreMemory } from '../persistence/kvStore.js';
import { enterWorld } from '../services/player/playerService.js';
import { enqueueClientAction } from '../net/transport.js';
import { resetEntityReplication } from '../net/entityReplication.js';
import { gameConfig } from '../gameConfig.js';
import { clearInstancesForTest } from '../services/world/instanceService.js';

// Fake timers don't reach the script realm's Date, so sandboxes created
// here read time from `scriptClock`, which each run advances itself.
const scriptClock = vi.hoisted(() => ({ now: 0 }));
vi.mock('node:vm', async (importOriginal) => {
  type Vm = typeof import('node:vm');
  const vm = await importOriginal<Vm & { default: Vm }>();
  const createContext = (
    sandbox: Record<string, unknown> = {},
    options?: Parameters<Vm['createContext']>[1],
  ) => {
    const ctx = vm.createContext(
      { ...sandbox, __scriptNow: () => scriptClock.now },
      options,
    );
    vm.runInContext('Date.now = __scriptNow;', ctx);
    return ctx;
  };
  return { ...vm, default: { ...vm.default, createContext }, createContext };
});

// magic's built-in spells, pre-seeded because seeding needs the database.
vi.mock('../services/content/spellService.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAllSpells: () => [
    {
      id: 1,
      name: 'Arcane Blast',
      description: '',
      sprite: 0,
      mpCost: 30,
      damage: 15,
      cooldownMs: 3000,
      target: 'enemies',
      heal: 0,
      frames: 1,
      visualTarget: 'targets',
    },
    {
      id: 2,
      name: 'Heal',
      description: '',
      sprite: 1,
      mpCost: 25,
      damage: 0,
      cooldownMs: 5000,
      target: 'self',
      heal: 0,
      frames: 1,
      visualTarget: 'self',
    },
  ],
}));

function makeTiles(rows: number, cols: number): Tile[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ tileIndex: 0, blocked: false })),
  );
}

function makeMap(): MapStateServer {
  return {
    id: '1',
    name: 'M',
    type: 'normal',
    tiles: makeTiles(20, 20),
    droppedItems: [],
    npcs: {},
    players: {},
  };
}

function makePlayer(): PlayerServer {
  return {
    id: 'a',
    name: 'Alice',
    sprite: 0,
    width: 64,
    height: 64,
    maxHealth: 100,
    attack: 10,
    attackRange: 64,
    level: 1,
    experience: 0,
    experienceToNextLevel: 100,
    inventory: { items: [], maxCapacity: 10 },
    equipped: {},
    access: 0,
    strength: 0,
    defense: 0,
    agility: 0,
    vitality: 0,
    unspentPoints: 0,
    speed: 1,
    mapId: '1',
    position: { x: 64, y: 64 },
    direction: Direction.Down,
    action: CharacterAction.Idle,
    health: 100,
    kind: 'player',
  };
}

function press(key: Key, type: 'press' | 'release') {
  handleKeyAction({
    username: 'Alice',
    type: 'keyboard',
    keyboardAction: { key, type },
  });
}

function step(ticks: number) {
  for (let i = 0; i < ticks; i++) {
    advanceTick();
    processMovementCompletion();
    processMovementIntent();
  }
}

function reset() {
  resetClock();
  for (const k of Object.keys(runtimeState.maps)) delete runtimeState.maps[k];
  for (const k of Object.keys(players)) delete players[k];
  playersByName.clear();
  pressedKeysMap.clear();
}

function runScript(): Position {
  reset();
  seedRng(123);

  const map = makeMap();
  runtimeState.maps['1'] = map;
  const player = makePlayer();
  registerPlayer(player);
  map.players[player.id] = player;

  press(Key.ArrowRight, 'press');
  step(18);
  press(Key.ArrowRight, 'release');
  press(Key.ArrowDown, 'press');
  step(18);
  press(Key.ArrowDown, 'release');
  step(6);

  return { ...getPlayerByName('Alice')!.position };
}

describe('deterministic replay', () => {
  it('reaches the same state for the same inputs and seed', () => {
    const a = runScript();
    const b = runScript();
    expect(a).toEqual(b);
  });

  it('actually moved the player', () => {
    const end = runScript();
    expect(end).not.toEqual({ x: 64, y: 64 });
  });
});

describe('deterministic replay with every module loaded', () => {
  const MODULES = fs
    .readdirSync(path.resolve(process.cwd(), 'modules'))
    .filter((id) =>
      fs.existsSync(path.resolve(process.cwd(), 'modules', id, 'module.json')),
    );
  const NAMES = ['Ann', 'Bo', 'Cy'];
  const TICKS = 400;

  const COIN = 1;
  const SWORD = 2;
  const POTION = 3;
  // A warp into an instanced dungeon.
  const DOOR = { col: 6, row: 3 };

  const keys = [Key.ArrowUp, Key.ArrowDown, Key.ArrowLeft, Key.ArrowRight];
  const chats = [
    '/pet',
    '/party create',
    '/party invite Bo',
    '/party accept Ann',
    '/party leave',
  ];

  /** One player's action on one tick; usually nothing. */
  const actionOf = (username: string): fc.Arbitrary<ClientAction | null> =>
    fc.oneof(
      { weight: 60, arbitrary: fc.constant(null) },
      {
        weight: 18,
        arbitrary: fc.record({
          username: fc.constant(username),
          type: fc.constant('keyboard' as const),
          keyboardAction: fc.record({
            key: fc.constantFrom(...keys, Key.Control),
            type: fc.constantFrom('press' as const, 'release' as const),
          }),
        }),
      },
      {
        weight: 4,
        arbitrary: fc.record({
          username: fc.constant(username),
          type: fc.constant('moveTo' as const),
          col: fc.nat({ max: 19 }),
          row: fc.nat({ max: 19 }),
        }),
      },
      {
        weight: 2,
        arbitrary: fc.record({
          username: fc.constant(username),
          type: fc.constant('moveTo' as const),
          col: fc.constant(DOOR.col),
          row: fc.constant(DOOR.row),
        }),
      },
      {
        weight: 4,
        arbitrary: fc.oneof(
          fc.record({
            username: fc.constant(username),
            type: fc.constant('item' as const),
            item: fc.constantFrom(SWORD, POTION),
            action: fc.constant('use' as const),
          }),
          fc.record({
            username: fc.constant(username),
            type: fc.constant('item' as const),
            item: fc.constantFrom(COIN, SWORD, POTION),
            action: fc.constant('drop' as const),
          }),
        ),
      },
      {
        weight: 4,
        arbitrary: fc.record({
          username: fc.constant(username),
          type: fc.constant('custom' as const),
          channel: fc.constant('spell:cast'),
          payload: fc.record({ id: fc.constantFrom('1', '2') }),
        }),
      },
      {
        weight: 1,
        arbitrary: fc.record({
          username: fc.constant(username),
          type: fc.constant('chat' as const),
          scope: fc.constant('map' as const),
          message: fc.constantFrom(...chats),
        }),
      },
    );

  /** Per-tick actions for every player in a session. */
  const script = fc
    .array(fc.tuple(...NAMES.map(actionOf)), {
      minLength: TICKS,
      maxLength: TICKS,
    })
    .map((ticks) =>
      ticks.map((acts) => acts.filter((a): a is ClientAction => a !== null)),
    );

  const CLOCK_START = 1_700_000_000_000;

  /**
   * Timestamps scripts store differ between runs, so any number inside the
   * script clock's span compares as a placeholder.
   */
  const clockReading = (_key: string, value: unknown) =>
    typeof value === 'number' &&
    value >= CLOCK_START &&
    value <= CLOCK_START + TICKS * 50
      ? 'a reading of the clock'
      : value;

  /** What a replay has to reproduce: everything players can see or keep. */
  function world(): string {
    const byId = (a: { id: string }, b: { id: string }) =>
      a.id.localeCompare(b.id);
    return JSON.stringify(
      Object.values(runtimeState.maps)
        .sort(byId)
        .map((map) => ({
          id: map.id,
          players: Object.values(map.players)
            .sort(byId)
            .map((p) => ({
              name: p.name,
              position: p.position,
              direction: p.direction,
              action: p.action,
              health: p.health,
              maxHealth: p.maxHealth,
              attack: p.attack,
              defense: p.defense,
              level: p.level,
              experience: p.experience,
              inventory: p.inventory.items,
              equipped: p.equipped,
              data: p.data,
              nameColor: p.nameColor,
            })),
          npcs: Object.values(map.npcs)
            .sort(byId)
            .map((n) => ({
              id: n.id,
              position: n.position,
              direction: n.direction,
              action: n.action,
              health: n.health,
            })),
          droppedItems: map.droppedItems,
        })),
      clockReading,
    );
  }

  function teardown() {
    clearInstancesForTest();
    unloadAllModules();
    clearAll();
    clearCommands();
    clearProvides();
    clearKvStoreMemory();
    drainGameEvents();
  }

  beforeEach(teardown);
  afterEach(teardown);

  /** World state after each tick, the script clock advancing `msPerTick`. */
  function run(script: ClientAction[][], msPerTick: number): string[] {
    teardown();
    const sim = createFixture(7);
    resetEntityReplication();
    // PvP on, so kills flag PKs.
    sim.map.pvp = 'normal';
    // Respawn map.
    sim.addMap({ id: gameConfig.world.startMapId });
    sim.addItem({
      id: COIN,
      name: 'Coin',
      description: '',
      sprite: 0,
      type: 'money',
    });
    sim.addItem({
      id: SWORD,
      name: 'Sword',
      description: '',
      sprite: 0,
      type: 'weapon',
      effects: [{ attribute: 'attack', type: 'add', value: 3 }],
    });
    sim.addItem({
      id: POTION,
      name: 'Potion',
      description: '',
      sprite: 0,
      type: 'consumable',
      effects: [{ attribute: 'health', type: 'add', value: 10 }],
    });
    scriptClock.now = CLOCK_START;
    loadModulesForTest(...MODULES);

    for (const [template, col, row, respawnMs] of [
      ['goblin', 8, 3, 1000],
      ['goblin', 12, 6, 1000],
      ['wolf', 15, 15, undefined],
    ] as const) {
      sim.map.tiles[row]![col]!.npcSpawn = template;
      sim.addNpc({
        id: `${template}:${row}:${col}`,
        templateId: template,
        behavior: template === 'wolf' ? 'hostile' : 'aggressive',
        position: tile(col, row),
        maxHealth: 12,
        health: 12,
        attack: 4,
        experienceValue: 5,
        respawnMs,
        moveIntervalMs: undefined,
      });
    }
    const skeleton = sim.addNpc({
      id: 'skeleton:4:4',
      templateId: 'skeleton',
      mapId: 'crypt',
      position: tile(4, 4),
      attack: 4,
      moveIntervalMs: undefined,
    });
    delete sim.map.npcs[skeleton.id];
    sim.addMap({
      id: 'crypt',
      instanced: true,
      npcs: { [skeleton.id]: skeleton },
    });
    sim.map.tiles[DOOR.row]![DOOR.col]!.warp = {
      to: 'crypt',
      position: tile(1, 1),
    };

    NAMES.forEach((name, i) => {
      enterWorld(
        sim.addPlayer({
          name,
          // Lined up facing each other with one-hit kills, so PvP fights and PK
          // flags happen early in every session.
          position: tile(5, 5 + i),
          attack: 200,
          inventory: {
            items: [
              { item: COIN, quantity: 10 },
              { item: SWORD, quantity: 1 },
              { item: POTION, quantity: 3 },
            ],
            maxCapacity: 10,
          },
        }),
      );
    });

    const frames: string[] = [];
    for (const actions of script) {
      for (const action of actions) enqueueClientAction(action);
      scriptClock.now += msPerTick;
      sim.step(1);
      frames.push(world());
    }
    return frames;
  }

  /** First tick where two runs differ, with both worlds. */
  function firstDivergence(a: string[], b: string[]) {
    const tick = a.findIndex((frame, i) => frame !== b[i]);
    if (tick === -1) return undefined;
    return { tick, a: JSON.parse(a[tick]!), b: JSON.parse(b[tick]!) };
  }

  it('reaches the same world twice from the same inputs', () => {
    fc.assert(
      fc.property(script, (inputs) => {
        const divergence = firstDivergence(run(inputs, 50), run(inputs, 50));
        expect(divergence?.b).toEqual(divergence?.a);
      }),
      // No shrinking: it is slow here, and the first divergent tick is enough.
      { numRuns: 8, endOnFailure: true },
    );
  });

  // Replays run as fast as possible, so anything a script times by wall
  // clock instead of ticks comes out different.
  it('reaches it whatever pace the wall clock keeps', () => {
    fc.assert(
      fc.property(script, (inputs) => {
        const divergence = firstDivergence(run(inputs, 50), run(inputs, 0));
        expect(divergence?.b).toEqual(divergence?.a);
      }),
      // No shrinking: it is slow here, and the first divergent tick is enough.
      { numRuns: 8, endOnFailure: true },
    );
  });
});
