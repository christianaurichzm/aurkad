import { resetClock, advanceTick, getTick } from './clock.js';
import { runScheduledTasks, resetScheduler } from './scheduler.js';
import { seedRng } from './rng.js';
import { emit } from '../engine/hooks.js';
import { players, playersByName, runtimeState } from './state.js';
import { registerPlayer, getPlayerByName } from './world.js';
import { items } from '../services/world/gameData.js';
import {
  pressedKeysMap,
  handleKeyAction,
  processMovementIntent,
  processMovementCompletion,
} from '../services/world/movementService.js';
import { clearAllAttackCooldowns } from '../services/combat/attackCooldown.js';
import { updateNpcs } from '../services/npc/index.js';
import { clearAllNpcAiState } from '../services/npc/aiBrain.js';
import { rebuildQuadtree } from '../spatial/spatialManager.js';
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

type KeyEvent = { username: string; key: Key; type: 'press' | 'release' };

export function createFixture(seed = 0) {
  resetClock();
  resetScheduler();
  seedRng(seed);
  _nextId = 1;

  for (const k of Object.keys(runtimeState.maps)) delete runtimeState.maps[k];
  for (const k of Object.keys(players)) delete players[k];
  playersByName.clear();
  pressedKeysMap.clear();
  items.clear();
  clearAllAttackCooldowns();
  clearAllNpcAiState();

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

  const pendingKeys: KeyEvent[] = [];

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
    map.players[player.id] = player;
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
      ...overrides,
    };
    map.npcs[npc.id] = npc;
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

  // Queue key events; processed AFTER the spatial rebuild each tick,
  // matching the real server's order: rebuild, processActions, movement.
  function press(username: string, key: Key) {
    pendingKeys.push({ username, key, type: 'press' });
  }

  function release(username: string, key: Key) {
    pendingKeys.push({ username, key, type: 'release' });
  }

  function step(ticks = 1) {
    for (let i = 0; i < ticks; i++) {
      advanceTick();

      for (const [mid, m] of Object.entries(runtimeState.maps)) {
        rebuildQuadtree(mid, m);
        const livePlayers = Object.values(m.players).filter(
          (player) => player.health > 0,
        );
        for (const npc of Object.values(m.npcs))
          updateNpcs(npc, m, livePlayers);
      }

      // Flush key events now that the spatial index is up to date
      for (const ev of pendingKeys) {
        handleKeyAction({
          username: ev.username,
          type: 'keyboard',
          keyboardAction: { key: ev.key, type: ev.type },
        });
      }
      pendingKeys.length = 0;

      processMovementCompletion();
      processMovementIntent();
      runScheduledTasks();
      emit('tick', { tick: getTick() });
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
    step,
    getPlayer,
  };
}
