import { TILE_SIZE, GAME_WIDTH, GAME_HEIGHT } from '../../shared/constants';
import { CombatTarget, MapStateServer, Warp } from '../../shared/types';
import { getMap } from '../gameData';

const isColliding = (a: CombatTarget, b: CombatTarget): boolean =>
  a.position.x < b.position.x + b.width &&
  a.position.x + a.width > b.position.x &&
  a.position.y < b.position.y + b.height &&
  a.position.y + a.height > b.position.y;

const isTileBlocked = (map: MapStateServer, x: number, y: number): boolean => {
  const row = Math.floor(y / TILE_SIZE);
  const col = Math.floor(x / TILE_SIZE);
  return !!map.tiles[row]?.[col]?.blocked;
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
  if (!character.mapId) return false;

  const map = getMap(character.mapId)!;
  const { players, npcs } = map;
  const { width, height } = character;
  const { x, y } = character.position;

  const characterCollision = [
    ...Object.values(npcs),
    ...Object.values(players),
  ].some((other) => other.id !== character.id && isColliding(character, other));

  const tileCollision = [
    isTileBlocked(map, x, y),
    isTileBlocked(map, x + width - 1, y),
    isTileBlocked(map, x, y + height - 1),
    isTileBlocked(map, x + width - 1, y + height - 1),
  ].some(Boolean);

  const borderCollision =
    x < 0 || y < 0 || x + width > GAME_WIDTH || y + height > GAME_HEIGHT;

  return characterCollision || tileCollision || borderCollision;
};

export const hasWarp = (character: CombatTarget): Warp | undefined => {
  if (!character.mapId) return undefined;

  const map = getMap(character.mapId)!;
  const { width, height } = character;
  const { x, y } = character.position;

  return [
    isTileWarp(map, x, y),
    isTileWarp(map, x + width - 1, y),
    isTileWarp(map, x, y + height - 1),
    isTileWarp(map, x + width - 1, y + height - 1),
  ].find(Boolean);
};
