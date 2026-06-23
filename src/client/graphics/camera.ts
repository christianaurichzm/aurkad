import { GAME_HEIGHT, GAME_WIDTH, TILE_SIZE } from '../../shared/constants';
import { mapPixelHeight, mapPixelWidth } from '../../shared/mapGeometry';
import { Tile } from '../../shared/types';

export interface Camera {
  x: number;
  y: number;
}

let current: Camera = { x: 0, y: 0 };

export const getCamera = (): Camera => current;
export const setCamera = (cam: Camera): void => {
  current = cam;
};

export const calcCamera = (
  playerX: number,
  playerY: number,
  tiles: Tile[][],
): Camera => {
  const mapW = mapPixelWidth(tiles);
  const mapH = mapPixelHeight(tiles);
  return {
    x: Math.max(
      0,
      Math.min(playerX + TILE_SIZE / 2 - GAME_WIDTH / 2, mapW - GAME_WIDTH),
    ),
    y: Math.max(
      0,
      Math.min(playerY + TILE_SIZE / 2 - GAME_HEIGHT / 2, mapH - GAME_HEIGHT),
    ),
  };
};

export const worldToScreen = (
  wx: number,
  wy: number,
): { x: number; y: number } => ({
  x: wx - current.x,
  y: wy - current.y,
});

export const screenToWorld = (
  sx: number,
  sy: number,
): { x: number; y: number } => ({
  x: sx + current.x,
  y: sy + current.y,
});
