/**
 * Netcode broadcast micro-benchmark: the per-tick broadcast cost before the
 * hot/cold split (whole map and enriched player every tick) against after
 * it (static map once, cold stats on change, hot diff per tick).
 *
 * Map serialization uses the real functions from
 * src/server/engine/serialization, which have no runtime deps; the player
 * hot/cold/enrich helpers are inlined copies of
 * src/server/services/playerService, so no DB, mongoose or ws is imported.
 *
 * Run: node --loader ts-node/esm scripts/benchNetcode.ts
 */
import * as jsondiffpatch from 'jsondiffpatch';
import {
  toMapStateClient,
  toMapDynamicClient,
  toMapStaticClient,
} from '../src/server/engine/serialization.js';
import { TILE_SIZE, EQUIPMENT_SLOTS } from '../src/shared/constants.js';
import {
  Access,
  CharacterAction,
  Direction,
  Item,
  MapStateServer,
  PlayerServer,
  Player,
  PlayerCold,
  PlayerHot,
  RuntimeNpc,
  Tile,
} from '../src/shared/types.js';

// Faithful copies of the player serializers (see playerService.ts).
const items = new Map<number, Item>();
const getItemById = (id: number): Item | null => items.get(id) ?? null;

function toPlayerHot(player: PlayerServer): PlayerHot {
  return {
    id: player.id,
    position: player.position,
    targetPosition: player.targetPosition,
    moving: player.moving,
    moveStartTime: player.moveStartTime,
    currentMoveDuration: player.currentMoveDuration,
    direction: player.direction,
    action: player.action,
    health: player.health,
  };
}

function toPlayerCold(player: PlayerServer): PlayerCold {
  const inventory = player.inventory.items.map((entry) => {
    const item = getItemById(entry.item);
    if (!item) throw new Error(`Item ${entry.item} not found`);
    return { item, quantity: entry.quantity };
  });
  const equipped: PlayerCold['equipped'] = {};
  for (const slot of EQUIPMENT_SLOTS) {
    const itemId = player.equipped[slot];
    if (itemId) {
      const item = getItemById(itemId);
      if (item) equipped[slot] = item;
    }
  }
  return {
    id: player.id,
    name: player.name,
    sprite: player.sprite,
    width: player.width,
    height: player.height,
    maxHealth: player.maxHealth,
    attack: player.attack,
    attackRange: player.attackRange,
    level: player.level,
    experience: player.experience,
    experienceToNextLevel: player.experienceToNextLevel,
    inventory,
    equipped,
    access: player.access,
    vitality: player.vitality,
    unspentPoints: player.unspentPoints,
    speed: player.speed,
    mapId: player.mapId,
    kind: 'player',
  };
}

function playerColdSignature(player: PlayerServer): string {
  return JSON.stringify([
    player.name,
    player.sprite,
    player.width,
    player.height,
    player.maxHealth,
    player.attack,
    player.attackRange,
    player.level,
    player.experience,
    player.experienceToNextLevel,
    player.access,
    player.vitality,
    player.unspentPoints,
    player.speed,
    player.mapId,
    player.inventory,
    player.equipped,
  ]);
}

function enrichPlayer(player: PlayerServer): Player {
  return { ...toPlayerCold(player), ...toPlayerHot(player) };
}

// Same diff config as wsServer.ts / client gameState.ts.
const diffPatcher = jsondiffpatch.create({
  objectHash: (obj: any, index?: number): string | undefined =>
    obj.id || obj.name || `$$index:${index}`,
  arrays: { detectMove: true, includeValueOnMove: false },
});

// Synthetic world.
function buildItems() {
  items.clear();
  items.set(1, { id: 1, name: 'Potion', description: 'Heals', sprite: 10, type: 'consumable' });
  items.set(2, { id: 2, name: 'Sword', description: 'Sharp', sprite: 11, type: 'weapon' });
  items.set(3, { id: 3, name: 'Helm', description: 'Sturdy', sprite: 12, type: 'helmet' });
  items.set(4, { id: 4, name: 'Boots', description: 'Fast', sprite: 13, type: 'boots' });
}

function buildTiles(rows: number, cols: number): Tile[][] {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => ({
      tileIndex: (r * cols + c) % 64,
      blocked: (r + c) % 7 === 0,
    })),
  );
}

function buildPlayer(i: number, cols: number, rows: number): PlayerServer {
  const x = (i % cols) * TILE_SIZE;
  const y = (i % rows) * TILE_SIZE;
  return {
    id: `p${i}`,
    name: `player${i}`,
    password: 'hash',
    position: { x, y },
    width: TILE_SIZE,
    height: TILE_SIZE,
    speed: 1,
    kind: 'player',
    attack: 100,
    vitality: 0,
    unspentPoints: 0,
    level: 1,
    experience: 0,
    experienceToNextLevel: 100,
    attackRange: TILE_SIZE,
    mapId: '1',
    sprite: i % 8,
    maxHealth: 100,
    health: 100,
    inventory: { items: [{ item: 1, quantity: 5 }], maxCapacity: 10 },
    equipped: { weapon: 2, helmet: 3, boots: 4 },
    access: Access.USER,
    direction: Direction.Down,
    action: CharacterAction.Idle,
  };
}

function buildNpc(i: number, cols: number, rows: number): RuntimeNpc {
  return {
    id: `n${i}`,
    name: `npc${i}`,
    sprite: i % 8,
    width: TILE_SIZE,
    height: TILE_SIZE,
    maxHealth: 50,
    attack: 10,
    attackRange: TILE_SIZE,
    behavior: 'hostile',
    position: { x: (i % cols) * TILE_SIZE, y: (i % rows) * TILE_SIZE },
    mapId: '1',
    direction: Direction.Down,
    action: CharacterAction.Idle,
    health: 50,
    kind: 'npc',
  };
}

function buildMap(rows: number, cols: number, players: PlayerServer[], npcCount: number): MapStateServer {
  const npcs: Record<string, RuntimeNpc> = {};
  for (let i = 0; i < npcCount; i++) {
    const npc = buildNpc(i, cols, rows);
    npcs[npc.id] = npc;
  }
  const map: MapStateServer = {
    id: '1',
    name: 'Bench Map',
    type: 'normal',
    tiles: buildTiles(rows, cols),
    droppedItems: Array.from({ length: 8 }, (_, i) => ({
      itemId: 1,
      sprite: 10,
      position: { x: (i % cols) * TILE_SIZE, y: (i % rows) * TILE_SIZE },
    })),
    npcs,
    players: {},
  };
  for (const p of players) map.players[p.id] = p;
  return map;
}

// Move every player one tile (wrapping) so each tick produces a non-empty
// position delta, the steady state during active play.
function stepWorld(map: MapStateServer, rows: number, cols: number) {
  for (const p of Object.values(map.players)) {
    p.position = {
      x: (p.position.x + TILE_SIZE) % (cols * TILE_SIZE),
      y: p.position.y,
    };
    p.action = CharacterAction.Walk;
  }
}

// Broadcast orchestrations (faithful to wsServer before/after).
function runOld(map: MapStateServer, ticks: number, rows: number, cols: number) {
  const lastSent = new Map<string, any>();
  let bytes = 0;
  const t0 = performance.now();
  for (let t = 0; t < ticks; t++) {
    stepWorld(map, rows, cols);
    for (const player of Object.values(map.players)) {
      const currentState = structuredClone({
        map: toMapStateClient(map, player, 0),
        player: enrichPlayer(player),
      });
      const lastState = lastSent.get(player.name);
      let msg: any = null;
      if (!lastState) msg = { type: 'fullGameState', payload: currentState };
      else {
        const delta = diffPatcher.diff(lastState, currentState);
        if (delta) msg = { type: 'gameStateDelta', payload: delta };
      }
      if (msg) {
        bytes += JSON.stringify(msg).length;
        lastSent.set(player.name, currentState);
      }
    }
  }
  return { ms: performance.now() - t0, bytes };
}

function runNew(map: MapStateServer, ticks: number, rows: number, cols: number) {
  const lastSent = new Map<string, any>();
  const lastMapId = new Map<string, string>();
  const lastMapRev = new Map<string, number>();
  const lastColdSig = new Map<string, string>();
  let bytes = 0;
  const t0 = performance.now();
  for (let t = 0; t < ticks; t++) {
    stepWorld(map, rows, cols);
    const mapRev = map.tilesRevision ?? 0;
    for (const player of Object.values(map.players)) {
      // static map (once)
      if (lastMapId.get(player.name) !== map.id || lastMapRev.get(player.name) !== mapRev) {
        bytes += JSON.stringify({ type: 'mapStatic', payload: toMapStaticClient(map) }).length;
        lastMapId.set(player.name, map.id);
        lastMapRev.set(player.name, mapRev);
        lastSent.delete(player.name);
      }
      // cold stats (on change)
      const sig = playerColdSignature(player);
      if (lastColdSig.get(player.name) !== sig) {
        bytes += JSON.stringify({ type: 'playerStats', payload: toPlayerCold(player) }).length;
        lastColdSig.set(player.name, sig);
      }
      // hot dynamic (per tick)
      const currentState = structuredClone({
        map: toMapDynamicClient(map, player, 0),
        player: toPlayerHot(player),
      });
      const lastState = lastSent.get(player.name);
      let msg: any = null;
      if (!lastState) msg = { type: 'fullGameState', payload: currentState };
      else {
        const delta = diffPatcher.diff(lastState, currentState);
        if (delta) msg = { type: 'gameStateDelta', payload: delta };
      }
      if (msg) {
        bytes += JSON.stringify(msg).length;
        lastSent.set(player.name, currentState);
      }
    }
  }
  return { ms: performance.now() - t0, bytes };
}

// Runner.
function bench(label: string, rows: number, cols: number, nPlayers: number, nNpcs: number) {
  const WARMUP = 30;
  const TICKS = 300;

  const mk = () => {
    const players = Array.from({ length: nPlayers }, (_, i) => buildPlayer(i, cols, rows));
    return buildMap(rows, cols, players, nNpcs);
  };

  // warmup (separate worlds so baselines don't leak into the measured run)
  runOld(mk(), WARMUP, rows, cols);
  runNew(mk(), WARMUP, rows, cols);

  const oldR = runOld(mk(), TICKS, rows, cols);
  const newR = runNew(mk(), TICKS, rows, cols);

  const msOldTick = oldR.ms / TICKS;
  const msNewTick = newR.ms / TICKS;
  const bOldTick = oldR.bytes / TICKS;
  const bNewTick = newR.bytes / TICKS;
  const cpuCut = (1 - msNewTick / msOldTick) * 100;
  const byteCut = (1 - bNewTick / bOldTick) * 100;

  console.log(`\n### ${label}  (map ${cols}x${rows} tiles, ${nPlayers} players, ${nNpcs} npcs)`);
  console.log(`  ms/tick   : antes ${msOldTick.toFixed(3)}  ->  agora ${msNewTick.toFixed(3)}   (${cpuCut >= 0 ? '-' : '+'}${Math.abs(cpuCut).toFixed(1)}% CPU)`);
  console.log(`  bytes/tick: antes ${Math.round(bOldTick).toLocaleString()}  ->  agora ${Math.round(bNewTick).toLocaleString()}   (${byteCut >= 0 ? '-' : '+'}${Math.abs(byteCut).toFixed(1)}% egress)`);
}

buildItems();
console.log('Netcode broadcast benchmark (300 measured ticks, warmup 30)');
bench('Current single-screen map', 14, 20, 50, 10);
bench('Current single-screen, busy', 14, 20, 100, 30);
bench('Larger map (future)', 40, 40, 50, 20);
bench('Big map (future)', 80, 80, 50, 20);
console.log('');
