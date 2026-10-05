import { TILE_SIZE } from '../../../shared/constants.js';
import {
  mapPixelWidth,
  mapPixelHeight,
  mapTileWidth,
  mapTileHeight,
} from '../../../shared/mapGeometry.js';
import {
  CombatTarget,
  MapStateServer,
  Position,
  Warp,
} from '../../../shared/types.js';
import { getMap } from './gameData.js';
import { queryNearbyEntities } from '../../spatial/spatialManager.js';

const isTileBlocked = (
  map: MapStateServer,
  x: number,
  y: number,
  forNpc = false,
): boolean => {
  const row = Math.floor(y / TILE_SIZE);
  const col = Math.floor(x / TILE_SIZE);

  if (
    row < 0 ||
    row >= map.tiles.length ||
    col < 0 ||
    (map.tiles[row] && col >= map.tiles[row].length)
  ) {
    return true;
  }

  const tile = map.tiles[row]?.[col];

  if (forNpc) {
    return !!tile?.blocked || !!tile?.avoidNpc;
  }

  return !!tile?.blocked;
};

const isTileWarp = (
  map: MapStateServer,
  x: number,
  y: number,
): Warp | undefined => {
  const row = Math.floor(y / TILE_SIZE);
  const col = Math.floor(x / TILE_SIZE);
  return map.tiles[row]?.[col]?.warp;
};

export const hasCollision = (character: CombatTarget): boolean => {
  if (!character.mapId) {
    return false;
  }

  const map = getMap(character.mapId);
  if (!map) {
    return true;
  }

  const { width, height, position } = character;
  const { x, y } = position;

  // The quadtree index instead of a full O(n) scan. It holds live entities,
  // so a position read here is current, not a tick-start snapshot: one
  // already moved this tick is seen where it is. Collision is therefore
  // order-dependent within a tick; reserve/commit movement would fix it.
  const nearby = queryNearbyEntities(character);
  const characterCollision = nearby.some(
    (other) =>
      other.id !== character.id &&
      // NPCs pass through each other; only players block NPC movement.
      !(character.kind === 'npc' && other.kind === 'npc') &&
      x < other.position.x + other.width &&
      x + width > other.position.x &&
      y < other.position.y + other.height &&
      y + height > other.position.y,
  );

  if (characterCollision) return true;

  const isNpc = character.kind === 'npc';

  // Every tile under the box, not just its corners: one three tiles wide has
  // a middle row and column the corners never land on. Steps a tile at a time
  // and always ends on the last pixel, so an unaligned box is covered too.
  const lastX = x + width - 1;
  const lastY = y + height - 1;
  for (let py = y; ; py = Math.min(py + TILE_SIZE, lastY)) {
    for (let px = x; ; px = Math.min(px + TILE_SIZE, lastX)) {
      if (isTileBlocked(map, px, py, isNpc)) return true;
      if (px >= lastX) break;
    }
    if (py >= lastY) break;
  }

  return (
    x < 0 ||
    y < 0 ||
    x + width > mapPixelWidth(map.tiles) ||
    y + height > mapPixelHeight(map.tiles)
  );
};

/** `value` moved onto the map, on the grid, with room for `size` pixels. */
const ontoMap = (value: number, mapTiles: number, size: number) =>
  Math.max(
    0,
    Math.min(value, (mapTiles - Math.ceil(size / TILE_SIZE)) * TILE_SIZE),
  );

/**
 * `position` pulled onto the map at its nearest edge, or as it is when the map
 * is not loaded here. Off the map, the client never receives the chunk under
 * the player and keeps the world covered in black, character included.
 */
export const onMap = (
  entity: { width: number; height: number },
  mapId: string,
  position: Position,
): Position => {
  const tiles = getMap(mapId)?.tiles;
  if (!tiles) return position;
  return {
    x: ontoMap(position.x, mapTileWidth(tiles), entity.width),
    y: ontoMap(position.y, mapTileHeight(tiles), entity.height),
  };
};

/**
 * How far out to look for somewhere to stand. Three rings is a 7x7 block of
 * tiles, which covers a crowded warp pad or a spawn point with a queue on it
 * without letting one placement walk across the map.
 */
const PLACEMENT_RINGS = 3;

/**
 * Tiles at exactly `ring` steps from the centre, nearest ring first.
 *
 * Fixed order rather than nearest-by-distance or random: placement happens
 * inside the simulation, so two runs of the same session have to choose the
 * same tile or a replay diverges from what it recorded.
 */
function ringOffsets(ring: number): Array<{ dx: number; dy: number }> {
  const offsets: Array<{ dx: number; dy: number }> = [];
  for (let dy = -ring; dy <= ring; dy++) {
    for (let dx = -ring; dx <= ring; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) === ring)
        offsets.push({ dx, dy });
    }
  }
  return offsets;
}

/**
 * The nearest tile to `desired` that `entity` can actually stand on, for
 * the arrivals that are not a step: a script teleport, a GM bring or goto,
 * a warp, a respawn. Two players on one tile after a bring, or corpses
 * respawning onto one spawn point, lasts until somebody walks away.
 *
 * A spot off the map is pulled onto it first (see onMap): coordinates typed
 * for a bigger map, or a border landing on a smaller one.
 *
 * Falls back to `desired` when everything nearby is taken. A teleport that
 * silently does not happen is worse than an overlap: the GM sees the player
 * stay put, the script sees its warp ignored, and neither is told why.
 */
export const findPlacement = (
  entity: CombatTarget,
  mapId: string,
  wanted: Position,
): Position => {
  const desired = onMap(entity, mapId, wanted);
  const probe = {
    id: entity.id,
    kind: entity.kind,
    mapId,
    width: entity.width,
    height: entity.height,
    position: desired,
  } as CombatTarget;

  if (!hasCollision(probe)) return desired;

  for (let ring = 1; ring <= PLACEMENT_RINGS; ring++) {
    for (const { dx, dy } of ringOffsets(ring)) {
      const candidate = {
        x: desired.x + dx * TILE_SIZE,
        y: desired.y + dy * TILE_SIZE,
      };
      if (!hasCollision({ ...probe, position: candidate })) return candidate;
    }
  }

  return desired;
};

export const hasWarp = (character: CombatTarget): Warp | undefined => {
  if (!character.mapId) {
    return undefined;
  }

  const map = getMap(character.mapId);
  if (!map) {
    return undefined;
  }

  const { width, height, position } = character;
  const { x, y } = position;

  return [
    isTileWarp(map, x, y),
    isTileWarp(map, x + width - 1, y),
    isTileWarp(map, x, y + height - 1),
    isTileWarp(map, x + width - 1, y + height - 1),
  ].find(Boolean);
};
