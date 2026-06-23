import { GAME_HEIGHT, GAME_WIDTH, TILE_SIZE } from './constants.js';
import { Tile } from './types.js';

export const mapTileWidth = (tiles: Tile[][]): number => tiles[0]?.length ?? 0;
export const mapTileHeight = (tiles: Tile[][]): number => tiles.length;
export const mapPixelWidth = (tiles: Tile[][]): number =>
  mapTileWidth(tiles) * TILE_SIZE;
export const mapPixelHeight = (tiles: Tile[][]): number =>
  mapTileHeight(tiles) * TILE_SIZE;

export interface Viewport {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function calcViewport(
  playerX: number,
  playerY: number,
  tiles: Tile[][],
  marginPx = 0,
): Viewport {
  const mapW = mapPixelWidth(tiles);
  const mapH = mapPixelHeight(tiles);
  const camX = Math.max(
    0,
    Math.min(playerX + TILE_SIZE / 2 - GAME_WIDTH / 2, mapW - GAME_WIDTH),
  );
  const camY = Math.max(
    0,
    Math.min(playerY + TILE_SIZE / 2 - GAME_HEIGHT / 2, mapH - GAME_HEIGHT),
  );
  return {
    left: camX - marginPx,
    top: camY - marginPx,
    right: camX + GAME_WIDTH + marginPx,
    bottom: camY + GAME_HEIGHT + marginPx,
  };
}
