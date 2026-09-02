import { GAME_HEIGHT, GAME_WIDTH, TILE_SIZE } from './constants.js';
import { Tile } from './types.js';

export const mapTileWidth = (tiles: Tile[][]): number => tiles[0]?.length ?? 0;
export const mapTileHeight = (tiles: Tile[][]): number => tiles.length;
export const mapPixelWidth = (tiles: Tile[][]): number =>
  mapTileWidth(tiles) * TILE_SIZE;
export const mapPixelHeight = (tiles: Tile[][]): number =>
  mapTileHeight(tiles) * TILE_SIZE;

/**
 * The tile a pixel position stands on, or undefined off the map. A player
 * mid-slide sits between two tiles, so the index is rounded, not floored:
 * the tile you stand on is the one you are nearest to.
 */
export const tileAt = (
  tiles: Tile[][],
  position: { x: number; y: number },
): Tile | undefined =>
  tiles[Math.round(position.y / TILE_SIZE)]?.[
    Math.round(position.x / TILE_SIZE)
  ];

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
