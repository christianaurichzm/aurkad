import { TILE_SIZE } from '../../shared/constants';
import {
  mapCamera,
  mapPixelHeight,
  mapPixelWidth,
  projectPoint,
  unprojectPoint,
} from '../../shared/mapGeometry';
import { Tile } from '../../shared/types';
import { getMapPixelSize, getMapOrientation } from '../core/gameState';

export interface Camera {
  x: number;
  y: number;
}
let current: Camera = { x: 0, y: 0 };
export const getCamera = (): Camera => current;
export const setCamera = (cam: Camera): void => {
  current = cam;
};
export function calcCamera(
  playerX: number,
  playerY: number,
  tiles?: Tile[][],
): Camera {
  const { w, h } = tiles
    ? { w: mapPixelWidth(tiles), h: mapPixelHeight(tiles) }
    : getMapPixelSize();
  return mapCamera(playerX, playerY, w, h, getMapOrientation());
}
export const worldToView = (x: number, y: number) =>
  projectPoint(x, y, getMapOrientation());

/** Upright artwork is anchored by its feet at the projected cell center. */
export function spritePosition(x: number, y: number) {
  if (getMapOrientation() !== 'isometric') return { x, y };
  const foot = worldToView(x + TILE_SIZE / 2, y + TILE_SIZE / 2);
  return { x: foot.x - TILE_SIZE / 2, y: foot.y - TILE_SIZE };
}
export const worldToScreen = (wx: number, wy: number) => {
  const p = worldToView(wx, wy);
  return { x: p.x - current.x, y: p.y - current.y };
};
export const screenToWorld = (sx: number, sy: number) =>
  unprojectPoint(sx + current.x, sy + current.y, getMapOrientation());
