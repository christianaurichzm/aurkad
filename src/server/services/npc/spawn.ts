import {
  RuntimeNpc,
  MapStateServer,
  NpcBehavior,
  CharacterAction,
  Direction,
} from '../../../shared/types.js';
import { TILE_SIZE } from '../../../shared/constants.js';
import { mapTileHeight, mapTileWidth } from '../../../shared/mapGeometry.js';
import { getMap } from '../../sim/world.js';
import { runtimeState } from '../../sim/state.js';
import { indexPlacement } from '../../sim/spatialManager.js';
import { findPlacement } from '../world/physicsService.js';
import { forgetReplicatedEntity } from '../../net/entityReplication.js';
import { clearDamageContributions } from '../combat/damage.js';
import { resetNpcAi } from './aiBrain.js';
import { npcMoveTicks } from './types.js';
import { emit } from '../../engine/hooks.js';
import { logger } from '../../logger.js';

// Runtime NPC spawning for scripts and modules (pets, summons, event
// bosses). Spawned NPCs live in map.npcs, so the quadtree and serialization
// pick them up, and are not persisted: they vanish on restart.

export interface SpawnNpcOptions {
  mapId: string;
  col: number;
  row: number;
  name?: string;
  sprite?: number;
  maxHealth?: number;
  attack?: number;
  attackRange?: number;
  behavior?: NpcBehavior;
  /** Tiles it notices a player from; absent is its behaviour's default. */
  sight?: number;
  /** Tiles it follows a target from where it appeared; 0 is no rope at all. */
  leash?: number;
  /** What its killer earns. */
  experienceValue?: number;
  /** Does not step onto another npc: a horde crowds round, not onto a tile. */
  solid?: boolean;
}

let spawnSeq = 0;

/** Test seam: ids start over with a fresh world, like every other counter. */
export function resetSpawnIds(): void {
  spawnSeq = 0;
}

/**
 * A number the caller supplied, or the default for anything else. Every
 * optional field has a default for "not given", and "not a number" gets the
 * same answer. A spawn tile and a health pool have no default worth
 * substituting, so they are checked below.
 */
const num = (value: number | undefined, fallback: number): number =>
  Number.isFinite(value) ? (value as number) : fallback;

// The tuning a content npc can leave out, left out the same way when it is
// not a number the npc can use.
const tuning = (value: number | undefined): number | undefined =>
  Number.isFinite(value) && (value as number) >= 0 ? value : undefined;

export function spawnNpc(opts: SpawnNpcOptions): RuntimeNpc | undefined {
  const map = getMap(opts.mapId);
  if (!map) return undefined;

  // Refused rather than defaulted: where an npc appears is the one thing the
  // caller has to mean. NaN reaches `position` and every later comparison
  // against it is false; a tile off the map is an entity the quadtree indexes,
  // the fan-out pays for and nobody can see. Floored because a tile index
  // between two tiles is not a place, it is a typo.
  const col = Math.floor(opts.col);
  const row = Math.floor(opts.row);
  if (
    !Number.isFinite(col) ||
    !Number.isFinite(row) ||
    col < 0 ||
    row < 0 ||
    col >= mapTileWidth(map.tiles) ||
    row >= mapTileHeight(map.tiles)
  ) {
    logger.warn('[spawn] refused: tile is not on this map', {
      mapId: opts.mapId,
      col: opts.col,
      row: opts.row,
    });
    return undefined;
  }

  // NaN health is unkillable: `NaN <= 0` is false, so the npc passes every
  // "is it dead" check (target selection, the death branch, the respawn
  // sweep) and stays in the world for the life of the process.
  const maxHealth = opts.maxHealth ?? 10;
  if (!Number.isFinite(maxHealth) || maxHealth <= 0) {
    logger.warn('[spawn] refused: maxHealth must be above zero', {
      mapId: opts.mapId,
      maxHealth: opts.maxHealth,
    });
    return undefined;
  }

  const id = `spawn:${++spawnSeq}`;
  const npc: RuntimeNpc = {
    id,
    name: String(opts.name ?? 'NPC'),
    sprite: Math.max(0, num(opts.sprite, 0)),
    width: TILE_SIZE,
    height: TILE_SIZE,
    maxHealth,
    health: maxHealth,
    attack: Math.max(0, num(opts.attack, 0)),
    attackRange: Math.max(0, num(opts.attackRange, TILE_SIZE)),
    behavior: opts.behavior ?? 'neutral',
    sight: tuning(opts.sight),
    leash: tuning(opts.leash),
    experienceValue: tuning(opts.experienceValue),
    solid: opts.solid === true || undefined,
    mapId: opts.mapId,
    position: { x: col * TILE_SIZE, y: row * TILE_SIZE },
    direction: Direction.Down,
    action: CharacterAction.Idle,
    kind: 'npc',
  };

  // The tile asked for decides where it lands, not what already stands
  // there, as for every arrival that is not a step. Rings outward from that
  // tile, so a blocked spawn point lands beside it, and falls back to the
  // tile itself when nothing nearby is free. Only a solid npc's steps are
  // blocked by npcs (see hasCollision) and this probe carries no `solid`, so
  // this is about walls and players, not stacking.
  npc.position = findPlacement(npc, map.id, npc.position);

  putNpcInWorld(map, npc);
  indexPlacement(map, npc);
  return npc;
}

// ---- who is due ----
//
// An npc acts every npcMoveTicks ticks, on a tick of its own within that
// interval taken from its id, so a map's npcs do not all think on one tick.
// They wait on a wheel of due ticks kept per npc table: a map loaded, saved
// in the editor or copied for an instance has a new table, and the wheel is
// built from it on its first tick. An entry left behind by a removal, a
// re-add or a content edit replacing the object is skipped, not taken out.

type Wheel = { next: number; due: Map<number, RuntimeNpc[]> };
const wheels = new WeakMap<Record<string, RuntimeNpc>, Wheel>();
/** The tick each npc was last put on a wheel for; any other entry is stale. */
const dueAt = new WeakMap<RuntimeNpc, number>();

/** FNV-1a, so the same id keeps the same tick in a replay. */
function phaseOf(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The first tick from `from` on which this npc's turn comes round. */
function firstDue(npc: RuntimeNpc, from: number): number {
  const every = npcMoveTicks(npc);
  const late = (from + (phaseOf(npc.id) % every)) % every;
  return late === 0 ? from : from + every - late;
}

function enqueue(wheel: Wheel, npc: RuntimeNpc, tick: number): void {
  dueAt.set(npc, tick);
  const bucket = wheel.due.get(tick);
  if (bucket) bucket.push(npc);
  else wheel.due.set(tick, [npc]);
}

/**
 * Puts an npc in its map's table and on the table's wheel. Every entry into
 * a table that already exists comes through here, as every exit goes
 * through removeNpcFromWorld: one written in directly never gets a turn.
 */
export function putNpcInWorld(map: MapStateServer, npc: RuntimeNpc): void {
  map.npcs[npc.id] = npc;
  const wheel = wheels.get(map.npcs);
  if (wheel) enqueue(wheel, npc, firstDue(npc, wheel.next));
}

/**
 * The npcs of this map whose turn is `tick`, each already back on the wheel
 * for its next one, so an update that throws does not cost it its place.
 */
export function dueNpcs(map: MapStateServer, tick: number): RuntimeNpc[] {
  // A map registered before its npcs were built has no table yet.
  if (!map.npcs) return [];
  let wheel = wheels.get(map.npcs);
  // A clock started over (a fresh simulation on the same table) would leave
  // every turn far in the future.
  if (!wheel || tick < wheel.next - 1) {
    wheel = { next: tick, due: new Map() };
    for (const npc of Object.values(map.npcs))
      enqueue(wheel, npc, firstDue(npc, tick));
    wheels.set(map.npcs, wheel);
  }
  const due: RuntimeNpc[] = [];
  for (; wheel.next <= tick; wheel.next++) {
    const bucket = wheel.due.get(wheel.next);
    if (!bucket) continue;
    wheel.due.delete(wheel.next);
    for (const npc of bucket) {
      if (dueAt.get(npc) !== wheel.next || map.npcs[npc.id] !== npc) continue;
      enqueue(wheel, npc, tick + npcMoveTicks(npc));
      due.push(npc);
    }
  }
  return due;
}

/**
 * Takes an npc off its map and lets go of everything kept under its id.
 * Every exit comes through here (a despawn, a death awaiting respawn, a map
 * save that dropped its spawn, an instance closing), so state keyed by npc
 * id is released in one place. A missed exit is silent: pet and summon
 * scripts pile up a replication baseline, a damage ledger and an ai state
 * per exit, and a respawn keeping the id is diffed against the corpse.
 */
export function removeNpcFromWorld(
  npc: RuntimeNpc,
  map: MapStateServer | undefined,
): void {
  if (map?.npcs[npc.id] === npc) delete map.npcs[npc.id];
  forgetReplicatedEntity(npc.id);
  clearDamageContributions(npc.id);
  resetNpcAi(npc);
  emit('npcRemoved', { npc });
}

// Remove a spawned NPC. Scans maps by id so it works even if the NPC's mapId
// drifted (e.g. a pet that followed its owner across a warp). The live object
// is what gets removed: the AI key includes mapId, which the caller's `{ id }`
// does not carry.
export function despawnNpc(npc: { id: string }): void {
  for (const map of Object.values(runtimeState.maps)) {
    const live = map.npcs[npc.id];
    if (!live) continue;
    removeNpcFromWorld(live, map);
    return;
  }
}
