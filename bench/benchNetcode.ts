/**
 * Netcode broadcast micro-benchmark: the per-tick broadcast cost before the
 * hot/cold split (whole map and enriched player every tick) against after
 * it (static map once, cold stats on change, hot diff per tick).
 *
 * Both paths are historical and document that the split paid off; the
 * protocol has since moved to mapMeta, streamed tile chunks and per-entity
 * fragments. For what the engine costs today, use `npm run loadtest`.
 *
 * What the earlier path needs is inlined, as the whole-map serializers and
 * the cold signature are gone from the server: the benchmark stays
 * reproducible without dead code there.
 *
 * Run: npm run bench   (node --loader ts-node/esm bench/benchNetcode.ts)
 */
import * as jsondiffpatch from 'jsondiffpatch';
import { calcViewport } from '../src/shared/mapGeometry.js';
import {
  toNpcPublic,
  toPlayerPublic,
} from '../src/server/net/serialization.js';
import {
  rebuildQuadtree,
  queryEntitiesInRect,
} from '../src/server/spatial/spatialManager.js';
import { TILE_SIZE, EQUIPMENT_SLOTS } from '../src/shared/constants.js';

// Mirrors config.net.aoiMarginTiles (default 2), inlined so the benchmark
// stays free of the server config/dotenv chain.
const AOI_MARGIN_PX = 2 * TILE_SIZE;
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
    moveTick: player.moveTick,
    moveDurationTicks: player.moveDurationTicks,
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
    inventoryCapacity: player.inventory.maxCapacity,
    equipped,
    access: player.access,
    strength: player.strength,
    defense: player.defense,
    agility: player.agility,
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
  objectHash: (
    obj: { id?: string; name?: string },
    index?: number,
  ): string | undefined => obj.id || obj.name || `$$index:${index}`,
  arrays: { detectMove: true, includeValueOnMove: false },
});

// Synthetic world.
function buildItems() {
  items.clear();
  items.set(1, {
    id: 1,
    name: 'Potion',
    description: 'Heals',
    sprite: 10,
    type: 'consumable',
  });
  items.set(2, {
    id: 2,
    name: 'Sword',
    description: 'Sharp',
    sprite: 11,
    type: 'weapon',
  });
  items.set(3, {
    id: 3,
    name: 'Helm',
    description: 'Sturdy',
    sprite: 12,
    type: 'helmet',
  });
  items.set(4, {
    id: 4,
    name: 'Boots',
    description: 'Fast',
    sprite: 13,
    type: 'boots',
  });
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
    position: { x, y },
    width: TILE_SIZE,
    height: TILE_SIZE,
    speed: 1,
    kind: 'player',
    attack: 100,
    strength: 0,
    defense: 0,
    agility: 0,
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

function buildMap(
  rows: number,
  cols: number,
  players: PlayerServer[],
  npcCount: number,
): MapStateServer {
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
      quantity: 1,
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
// ---------------------------------------------------------------------------
// Historical whole-map serializers: copies of what
// src/server/net/serialization.ts exported before tiles streamed as chunks,
// kept here since production sends no whole-map payload and the server
// should hold no dead path for a benchmark.
// ---------------------------------------------------------------------------

function inViewport(
  pos: { x: number; y: number },
  vp: { left: number; right: number; top: number; bottom: number },
): boolean {
  return (
    pos.x >= vp.left &&
    pos.x <= vp.right &&
    pos.y >= vp.top &&
    pos.y <= vp.bottom
  );
}

function toMapStaticClient(map: MapStateServer) {
  return {
    id: map.id,
    name: map.name,
    type: map.type,
    pvp: map.pvp,
    tiles: map.tiles,
  };
}

function toMapDynamicClient(
  map: MapStateServer,
  viewer: PlayerServer,
  viewport: { left: number; right: number; top: number; bottom: number },
) {
  const nearby = queryEntitiesInRect(map.id, {
    x: viewport.left,
    y: viewport.top,
    width: viewport.right - viewport.left,
    height: viewport.bottom - viewport.top,
  });

  const players: Record<string, unknown> = {};
  const npcs: Record<string, unknown> = {};

  for (const entity of nearby) {
    if (!entity.id) continue;
    if (entity.kind === 'player') {
      if (entity.id === viewer.id) continue;
      const other = map.players[entity.id];
      if (other) players[entity.id] = toPlayerPublic(other);
    } else if (entity.kind === 'npc') {
      const npc = map.npcs[entity.id];
      if (npc) npcs[entity.id] = toNpcPublic(npc);
    }
  }

  return {
    id: map.id,
    droppedItems: map.droppedItems.filter((item) =>
      inViewport(item.position, viewport),
    ),
    npcs,
    players,
  };
}

function toMapStateClient(
  map: MapStateServer,
  viewer: PlayerServer,
  viewport: { left: number; right: number; top: number; bottom: number },
) {
  return {
    ...toMapStaticClient(map),
    ...toMapDynamicClient(map, viewer, viewport),
  };
}

function runOld(
  map: MapStateServer,
  ticks: number,
  rows: number,
  cols: number,
) {
  const lastSent = new Map<string, unknown>();
  let bytes = 0;
  const t0 = performance.now();
  for (let t = 0; t < ticks; t++) {
    stepWorld(map, rows, cols);
    // The sim loop rebuilds the quadtree each tick (sim/loop.ts); serialization
    // queries it for AOI, so the bench must do the same or it measures nothing.
    rebuildQuadtree(map.id, map);
    for (const player of Object.values(map.players)) {
      const currentState = structuredClone({
        map: toMapStateClient(
          map,
          player,
          calcViewport(
            player.position.x,
            player.position.y,
            map.tiles,
            AOI_MARGIN_PX,
          ),
        ),
        player: enrichPlayer(player),
      });
      const lastState = lastSent.get(player.name);
      let msg: { type: string; payload: unknown } | null = null;
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

function runNew(
  map: MapStateServer,
  ticks: number,
  rows: number,
  cols: number,
) {
  const lastSent = new Map<string, unknown>();
  const lastMapId = new Map<string, string>();
  const lastMapRev = new Map<string, number>();
  const lastColdSig = new Map<string, string>();
  let bytes = 0;
  const t0 = performance.now();
  for (let t = 0; t < ticks; t++) {
    stepWorld(map, rows, cols);
    rebuildQuadtree(map.id, map);
    const mapRev = map.tilesRevision ?? 0;
    for (const player of Object.values(map.players)) {
      // static map (once)
      if (
        lastMapId.get(player.name) !== map.id ||
        lastMapRev.get(player.name) !== mapRev
      ) {
        bytes += JSON.stringify({
          type: 'mapStatic',
          payload: toMapStaticClient(map),
        }).length;
        lastMapId.set(player.name, map.id);
        lastMapRev.set(player.name, mapRev);
        lastSent.delete(player.name);
      }
      // cold stats (on change)
      const sig = playerColdSignature(player);
      if (lastColdSig.get(player.name) !== sig) {
        bytes += JSON.stringify({
          type: 'playerStats',
          payload: toPlayerCold(player),
        }).length;
        lastColdSig.set(player.name, sig);
      }
      // hot dynamic (per tick). No structuredClone: toMapDynamicClient and
      // toPlayerHot already return fresh objects, stored straight into
      // lastSentStates (snapshot.ts), so cloning would measure a cost
      // production never pays.
      const currentState = {
        map: toMapDynamicClient(
          map,
          player,
          calcViewport(
            player.position.x,
            player.position.y,
            map.tiles,
            AOI_MARGIN_PX,
          ),
        ),
        player: toPlayerHot(player),
      };
      const lastState = lastSent.get(player.name);
      let msg: { type: string; payload: unknown } | null = null;
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

// ─── SPIKE: entity replication without a generic tree diff ──────────────────
// An entity's public state is the same for every viewer, yet the current
// path rebuilds and re-diffs it per viewer (O(N^2) deep walks). Here each
// entity is serialized once per tick and the fragment reused by every
// viewer that sees it, with field-level deltas keeping the bytes
// comparable to jsondiffpatch's output.
//
// A spike for a decision, not production code: it skips droppedItems and
// reuses the bench's toPlayerHot.

type PubState = Record<string, unknown>;

// Shallow field delta over the known-shape public state. Position and
// targetPosition compare by value, as they are rebuilt objects every tick.
function fieldDelta(prev: PubState, next: PubState): PubState | null {
  let out: PubState | null = null;
  for (const key of Object.keys(next)) {
    const a = prev[key];
    const b = next[key];
    let changed: boolean;
    if (b !== null && typeof b === 'object') {
      changed = JSON.stringify(a) !== JSON.stringify(b);
    } else {
      changed = a !== b;
    }
    if (changed) {
      out ??= {};
      out[key] = b;
    }
  }
  return out;
}

function runProto(
  map: MapStateServer,
  ticks: number,
  rows: number,
  cols: number,
) {
  const prevEntity = new Map<string, PubState>();
  const viewerKnown = new Map<string, Set<string>>();
  let bytes = 0;
  const t0 = performance.now();

  for (let t = 0; t < ticks; t++) {
    stepWorld(map, rows, cols);
    rebuildQuadtree(map.id, map);

    // Phase 1: once per entity, not per viewer.
    const fullJson = new Map<string, string>();
    const deltaJson = new Map<string, string>();

    const record = (id: string, pub: PubState) => {
      fullJson.set(id, JSON.stringify(pub));
      const prev = prevEntity.get(id);
      if (prev) {
        const d = fieldDelta(prev, pub);
        if (d) deltaJson.set(id, JSON.stringify(d));
      }
      prevEntity.set(id, pub);
    };

    for (const p of Object.values(map.players)) {
      record(p.id, toPlayerPublic(p) as unknown as PubState);
    }
    for (const npc of Object.values(map.npcs)) {
      if (npc.health > 0) record(npc.id, npc as unknown as PubState);
    }

    // Phase 2, per viewer: AOI query and assembly from the cached fragments,
    // with no object-graph diffing, only string concatenation.
    for (const viewer of Object.values(map.players)) {
      const vp = calcViewport(
        viewer.position.x,
        viewer.position.y,
        map.tiles,
        AOI_MARGIN_PX,
      );
      const nearby = queryEntitiesInRect(map.id, {
        x: vp.left,
        y: vp.top,
        width: vp.right - vp.left,
        height: vp.bottom - vp.top,
      });

      const known = viewerKnown.get(viewer.name) ?? new Set<string>();
      const current = new Set<string>();
      const parts: string[] = [];

      for (const e of nearby) {
        if (!e.id || e.id === viewer.id) continue;
        current.add(e.id);
        // Entering the viewport needs the full state; an already-known entity
        // only needs what changed globally this tick.
        const fragment = known.has(e.id)
          ? deltaJson.get(e.id)
          : fullJson.get(e.id);
        if (fragment) parts.push(`"${e.id}":${fragment}`);
      }

      const leaving: string[] = [];
      for (const id of known) if (!current.has(id)) leaving.push(id);

      if (parts.length > 0 || leaving.length > 0) {
        const self = JSON.stringify(toPlayerHot(viewer));
        const leave =
          leaving.length > 0 ? `,"leave":${JSON.stringify(leaving)}` : '';
        bytes +=
          `{"type":"entityUpdate","e":{${parts.join(',')}},"self":${self}${leave}}`
            .length;
      }

      viewerKnown.set(viewer.name, current);
    }
  }

  return { ms: performance.now() - t0, bytes };
}

// CLI: `--scenario=<substring>` runs only matching scenarios and
// `--path=new|old` only one code path, so a profiler (node --prof) can be
// pointed at one scenario; the legacy path, several times slower, would
// otherwise dominate the profile.
const argv = process.argv.slice(2);
const argOf = (name: string): string | undefined =>
  argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const scenarioFilter = argOf('scenario')?.toLowerCase();
const pathFilter = argOf('path');
const runOldEnabled = pathFilter === undefined || pathFilter === 'old';
const runNewEnabled = pathFilter === undefined || pathFilter === 'new';
const runProtoEnabled = pathFilter === undefined || pathFilter === 'proto';

// Runner.
function bench(
  label: string,
  rows: number,
  cols: number,
  nPlayers: number,
  nNpcs: number,
) {
  if (scenarioFilter && !label.toLowerCase().includes(scenarioFilter)) return;

  const WARMUP = 30;
  const TICKS = 300;

  const mk = () => {
    const players = Array.from({ length: nPlayers }, (_, i) =>
      buildPlayer(i, cols, rows),
    );
    return buildMap(rows, cols, players, nNpcs);
  };

  // warmup (separate worlds so baselines don't leak into the measured run)
  if (runOldEnabled) runOld(mk(), WARMUP, rows, cols);
  if (runNewEnabled) runNew(mk(), WARMUP, rows, cols);
  if (runProtoEnabled) runProto(mk(), WARMUP, rows, cols);

  const oldR = runOldEnabled ? runOld(mk(), TICKS, rows, cols) : null;
  const newR = runNewEnabled ? runNew(mk(), TICKS, rows, cols) : null;
  const protoR = runProtoEnabled ? runProto(mk(), TICKS, rows, cols) : null;

  console.log(
    `\n### ${label}  (map ${cols}x${rows} tiles, ${nPlayers} players, ${nNpcs} npcs)`,
  );

  const line = (
    tag: string,
    r: { ms: number; bytes: number },
    ref?: { ms: number; bytes: number } | null,
  ) => {
    const ms = r.ms / TICKS;
    const b = r.bytes / TICKS;
    let suffix = '';
    if (ref) {
      const cpu = (1 - ms / (ref.ms / TICKS)) * 100;
      const eg = (1 - b / (ref.bytes / TICKS)) * 100;
      suffix = `   (CPU ${cpu >= 0 ? '-' : '+'}${Math.abs(cpu).toFixed(1)}%, egress ${eg >= 0 ? '-' : '+'}${Math.abs(eg).toFixed(1)}% vs agora)`;
    }
    console.log(
      `  ${tag.padEnd(6)}: ${ms.toFixed(3).padStart(8)} ms/tick   ${Math.round(b).toLocaleString().padStart(9)} bytes/tick${suffix}`,
    );
  };

  if (oldR) line('antes', oldR);
  if (newR) line('agora', newR);
  if (protoR) line('proto', protoR, newR);
}

buildItems();
console.log('Netcode broadcast benchmark (300 measured ticks, warmup 30)');
bench('Current single-screen map', 14, 20, 50, 10);
bench('Current single-screen, busy', 14, 20, 100, 30);
bench('Larger map (future)', 40, 40, 50, 20);
bench('Big map (future)', 80, 80, 50, 20);
console.log('');
