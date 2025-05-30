import { GAME_HEIGHT, GAME_WIDTH, TILE_SIZE } from '../../shared/constants.js';
import { CombatTarget, MapStateServer, Warp } from '../../shared/types.js';
import { getMap } from '../gameData.js';

const isColliding = (a: CombatTarget, b: CombatTarget): boolean =>
  a.position.x < b.position.x + b.width &&
  a.position.x + a.width > b.position.x &&
  a.position.y < b.position.y + b.height &&
  a.position.y + a.height > b.position.y;

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

  const { players, npcs } = map;
  const { width, height, position } = character;
  const { x, y } = position;

  const characterCollision = [
    ...Object.values(npcs),
    ...Object.values(players),
  ].some((other) => other.id !== character.id && isColliding(character, other));

  if (characterCollision) return true;

  const isNpc = character.kind === 'npc';

  const tileCollision =
    isTileBlocked(map, x, y, isNpc) ||
    isTileBlocked(map, x + width - 1, y, isNpc) ||
    isTileBlocked(map, x, y + height - 1, isNpc) ||
    isTileBlocked(map, x + width - 1, y + height - 1, isNpc);

  if (tileCollision) return true;

  const borderCollision =
    x < 0 || y < 0 || x + width > GAME_WIDTH || y + height > GAME_HEIGHT;

  return borderCollision;
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
