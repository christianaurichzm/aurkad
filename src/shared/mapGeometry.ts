import {
  GAME_HEIGHT,
  GAME_WIDTH,
  ISO_SCALE,
  TILE_SIZE,
  MAX_ISOMETRIC_OVERHANG,
} from './constants.js';
import { Tile, MapOrientation } from './types.js';

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

/**
 * Where a simulation point lands in view pixels. Movement, collision and every
 * stored coordinate stay on the square grid; only drawing and picking cross
 * this line, so a map's projection never reaches the rules.
 */
export function projectPoint(
  x: number,
  y: number,
  orientation?: MapOrientation,
) {
  return orientation === 'isometric'
    ? { x: (x - y) * ISO_SCALE, y: ((x + y) * ISO_SCALE) / 2 }
    : { x, y };
}

export function unprojectPoint(
  x: number,
  y: number,
  orientation?: MapOrientation,
) {
  return orientation === 'isometric'
    ? { x: (x + 2 * y) / (2 * ISO_SCALE), y: (2 * y - x) / (2 * ISO_SCALE) }
    : { x, y };
}

export function mapCamera(
  playerX: number,
  playerY: number,
  mapW: number,
  mapH: number,
  orientation?: MapOrientation,
) {
  const center = projectPoint(
    playerX + TILE_SIZE / 2,
    playerY + TILE_SIZE / 2,
    orientation,
  );
  const left = projectPoint(0, mapH, orientation).x;
  const right = projectPoint(mapW, 0, orientation).x;
  const bottom = projectPoint(mapW, mapH, orientation).y;
  const centered = orientation === 'isometric';
  const clamp = (value: number, min: number, max: number, size: number) =>
    centered && max - min < size
      ? (min + max - size) / 2
      : Math.max(min, Math.min(value - size / 2, max - size));
  // Whole pixels: the player position this follows is interpolated, and a
  // fractional camera lands every tile between two pixels of the buffer.
  return {
    x: Math.round(clamp(center.x, left, right, GAME_WIDTH)),
    y: Math.round(clamp(center.y, 0, bottom, GAME_HEIGHT)),
  };
}

/** Conservative bounds of all four screen corners, with sprite overhang. */
export function viewBounds(
  x: number,
  y: number,
  width: number,
  height: number,
  orientation?: MapOrientation,
  margin = 0,
): Viewport {
  const points = [
    unprojectPoint(x - margin, y - margin, orientation),
    unprojectPoint(x + width + margin, y - margin, orientation),
    unprojectPoint(x - margin, y + height + margin, orientation),
    unprojectPoint(x + width + margin, y + height + margin, orientation),
  ];
  return {
    left: Math.min(...points.map((p) => p.x)),
    top: Math.min(...points.map((p) => p.y)),
    right: Math.max(...points.map((p) => p.x)),
    bottom: Math.max(...points.map((p) => p.y)),
  };
}

export function calcViewport(
  playerX: number,
  playerY: number,
  tiles: Tile[][],
  marginPx = 0,
  orientation?: MapOrientation,
): Viewport {
  const cam = mapCamera(
    playerX,
    playerY,
    mapPixelWidth(tiles),
    mapPixelHeight(tiles),
    orientation,
  );
  return viewBounds(
    cam.x,
    cam.y,
    GAME_WIDTH,
    GAME_HEIGHT,
    orientation,
    marginPx + (orientation === 'isometric' ? MAX_ISOMETRIC_OVERHANG : 0),
  );
}
