import { resetClock } from './clock.js';
import { resetScheduler } from './scheduler.js';
import { seedRng } from './rng.js';
import { tickSystems } from './loop.js';
import { dropQuadtree } from './spatialManager.js';
import { players, playersByName, runtimeState } from './state.js';
import { registerPlayer, getPlayerByName } from './world.js';
import { items } from '../services/content/itemService.js';
import {
  pressedKeysMap,
  clearAllPathGoals,
} from '../services/world/movementService.js';
import { clearAllAttackCooldowns } from '../services/combat/attackCooldown.js';
import { clearAllDamageContributions } from '../services/combat/damage.js';
import { clearAllNpcAiState } from '../services/npc/aiBrain.js';
import { putNpcInWorld, resetSpawnIds } from '../services/npc/spawn.js';
import { clearActionQueue, enqueueClientAction } from '../net/transport.js';
import {
  CharacterAction,
  Direction,
  Item,
  Key,
  MapStateServer,
  PlayerServer,
  Position,
  RuntimeNpc,
  Tile,
} from '../../shared/types.js';
import { TILE_SIZE } from '../../shared/constants.js';
import { logger } from '../logger.js';

let _nextId = 1;
const uid = () => `e${_nextId++}`;

export function tile(col: number, row: number): Position {
  return { x: col * TILE_SIZE, y: row * TILE_SIZE };
}

export function makeTiles(rows: number, cols: number): Tile[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ tileIndex: 0, blocked: false })),
  );
}

export function createFixture(seed = 0) {
  resetClock();
  resetScheduler();
  seedRng(seed);
  _nextId = 1;

  // A spatial index keeps its branches across rebuilds, and their shape
  // orders query results, which break ties such as an npc's nearest target.
  for (const k of Object.keys(runtimeState.maps)) {
    delete runtimeState.maps[k];
    dropQuadtree(k);
  }
  for (const k of Object.keys(players)) delete players[k];
  playersByName.clear();
  pressedKeysMap.clear();
  clearAllPathGoals();
  items.clear();
  clearAllAttackCooldowns();
  clearAllDamageContributions();
  clearAllNpcAiState();
  resetSpawnIds();
  clearActionQueue();

  const mapId = 'map1';
  const map: MapStateServer = {
    id: mapId,
    name: 'Test',
    type: 'normal',
    tiles: makeTiles(20, 20),
    droppedItems: [],
    npcs: {},
    players: {},
  };
  runtimeState.maps[mapId] = map;

  function addPlayer(overrides: Partial<PlayerServer> = {}): PlayerServer {
    const id = overrides.id ?? uid();
    const player: PlayerServer = {
      id,
      name: `Player_${id}`,
      sprite: 0,
      width: TILE_SIZE,
      height: TILE_SIZE,
      maxHealth: 100,
      attack: 10,
      attackRange: TILE_SIZE,
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
      mapId,
      position: { x: TILE_SIZE, y: TILE_SIZE },
      direction: Direction.Down,
      action: CharacterAction.Idle,
      health: 100,
      kind: 'player',
      ...overrides,
    };
    registerPlayer(player);
    // Register on the player's own map, not map1.
    (runtimeState.maps[player.mapId] ?? map).players[player.id] = player;
    return player;
  }

  function addNpc(overrides: Partial<RuntimeNpc> = {}): RuntimeNpc {
    const id = overrides.id ?? uid();
    const npc: RuntimeNpc = {
      id,
      name: `Npc_${id}`,
      sprite: 0,
      width: TILE_SIZE,
      height: TILE_SIZE,
      maxHealth: 30,
      attack: 5,
      attackRange: TILE_SIZE,
      behavior: 'aggressive',
      mapId,
      position: { x: 5 * TILE_SIZE, y: 5 * TILE_SIZE },
      direction: Direction.Down,
      action: CharacterAction.Idle,
      health: 30,
      kind: 'npc',
      // One npc decision per step(). Pace tests pass their own value, or
      // undefined for the game default.
      moveIntervalMs: 1,
      ...overrides,
    };
    putNpcInWorld(map, npc);
    return npc;
  }

  function addItem(item: Item) {
    items.set(item.id, item);
  }

  function addMap(
    partial: Partial<MapStateServer> & { id: string },
  ): MapStateServer {
    const { id, ...rest } = partial;
    const m: MapStateServer = {
      id,
      name: id,
      type: 'normal',
      tiles: makeTiles(20, 20),
      droppedItems: [],
      npcs: {},
      players: {},
      ...rest,
    };
    runtimeState.maps[m.id] = m;
    return m;
  }

  // Goes through the real action queue, so players act before npcs within
  // a tick, as on a live server.
  function press(username: string, key: Key) {
    enqueueClientAction({
      username,
      type: 'keyboard',
      keyboardAction: { key, type: 'press' },
    });
  }

  function release(username: string, key: Key) {
    enqueueClientAction({
      username,
      type: 'keyboard',
      keyboardAction: { key, type: 'release' },
    });
  }

  // Clicks share the key queue, so their order is kept as from a real client.
  function moveTo(username: string, col: number, row: number) {
    enqueueClientAction({ username, type: 'moveTo', col, row });
  }

  // The live loop logs and swallows throws; here errorThrottled rethrows so
  // the test that caused one fails.
  function step(ticks = 1) {
    const report = logger.errorThrottled;
    logger.errorThrottled = (_key, msg, ctx) => {
      throw ctx?.err instanceof Error ? ctx.err : new Error(msg);
    };
    try {
      for (let i = 0; i < ticks; i++) {
        for (const system of tickSystems) system.run();
      }
    } finally {
      logger.errorThrottled = report;
    }
  }

  function getPlayer(name: string): PlayerServer {
    const p = getPlayerByName(name);
    if (!p) throw new Error(`Player "${name}" not found`);
    return p;
  }

  return {
    map,
    mapId,
    addPlayer,
    addNpc,
    addItem,
    addMap,
    press,
    release,
    moveTo,
    step,
    getPlayer,
  };
}
