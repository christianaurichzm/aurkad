import { TILE_SIZE } from '../../../shared/constants.js';
import { mapPixelWidth, mapPixelHeight } from '../../../shared/mapGeometry.js';
import { CombatTarget, MapStateServer, Warp } from '../../../shared/types.js';
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

  // The quadtree spatial index instead of a full O(n) scan. It is rebuilt at
  // the start of each tick in rebuildSpatialIndexes, so positions here are the
  // state at tick start (snapshot-based collision).
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

  const tileCollision =
    isTileBlocked(map, x, y, isNpc) ||
    isTileBlocked(map, x + width - 1, y, isNpc) ||
    isTileBlocked(map, x, y + height - 1, isNpc) ||
    isTileBlocked(map, x + width - 1, y + height - 1, isNpc);

  if (tileCollision) return true;

  return (
    x < 0 ||
    y < 0 ||
    x + width > mapPixelWidth(map.tiles) ||
    y + height > mapPixelHeight(map.tiles)
  );
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
