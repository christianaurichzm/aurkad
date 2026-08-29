import { GAME_HEIGHT, GAME_WIDTH, TILE_SIZE } from '../../shared/constants';
import { mapPixelHeight, mapPixelWidth } from '../../shared/mapGeometry';
import { Tile } from '../../shared/types';
import { getMapPixelSize } from '../core/gameState';

export interface Camera {
  x: number;
  y: number;
}

let current: Camera = { x: 0, y: 0 };

export const getCamera = (): Camera => current;
export const setCamera = (cam: Camera): void => {
  current = cam;
};

// Overload: prefer the no-tiles form (uses dimensions cached in gameState) to
// avoid array access on every render frame. The tiles overload is retained for
// call-sites that don't have gameState available (e.g. the server-side viewport
// or the map editor), or as a fallback when the cache is not yet populated.
export function calcCamera(playerX: number, playerY: number): Camera;
export function calcCamera(
  playerX: number,
  playerY: number,
  tiles: Tile[][],
): Camera;
export function calcCamera(
  playerX: number,
  playerY: number,
  tiles?: Tile[][],
): Camera {
  let mapW: number;
  let mapH: number;
  if (tiles) {
    mapW = mapPixelWidth(tiles);
    mapH = mapPixelHeight(tiles);
  } else {
    ({ w: mapW, h: mapH } = getMapPixelSize());
  }
  // Whole pixels: the player position this follows is interpolated, so the
  // camera it produces was fractional, and every tile drawn under it landed
  // between two pixels of the buffer. Rounded here rather than at each blit
  // because this is where the fraction enters the drawing, and the clamps are
  // both whole pixels already.
  return {
    x: Math.round(
      Math.max(
        0,
        Math.min(playerX + TILE_SIZE / 2 - GAME_WIDTH / 2, mapW - GAME_WIDTH),
      ),
    ),
    y: Math.round(
      Math.max(
        0,
        Math.min(playerY + TILE_SIZE / 2 - GAME_HEIGHT / 2, mapH - GAME_HEIGHT),
      ),
    ),
  };
}

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
