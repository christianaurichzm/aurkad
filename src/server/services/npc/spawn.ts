import {
  RuntimeNpc,
  NpcBehavior,
  CharacterAction,
  Direction,
} from '../../../shared/types.js';
import { TILE_SIZE } from '../../../shared/constants.js';
import { mapTileHeight, mapTileWidth } from '../../../shared/mapGeometry.js';
import { getMap, runtimeState } from '../world/gameData.js';
import { findPlacement } from '../world/physicsService.js';
import { forgetReplicatedEntity } from '../../net/snapshot.js';
import { clearDamageContributions } from '../combat/damage.js';
import { resetNpcAi } from './aiBrain.js';
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

  map.npcs[id] = npc;
  return npc;
}

// Remove a spawned NPC. Scans maps by id so it works even if the NPC's mapId
// drifted (e.g. a pet that followed its owner across a warp).
export function despawnNpc(npc: { id: string }): void {
  for (const map of Object.values(runtimeState.maps)) {
    const live = map.npcs[npc.id];
    if (!live) continue;

    delete map.npcs[npc.id];
    // Everything keyed by this id has to go with it. Without this a server
    // running pet or summon scripts accumulates a public-state snapshot and an
    // AI state per despawn, for the life of the process. The live object is
    // what gets passed on: the AI key includes mapId, which the caller's
    // `{ id }` does not carry.
    forgetReplicatedEntity(npc.id);
    clearDamageContributions(npc.id);
    resetNpcAi(live);
    return;
  }
}
