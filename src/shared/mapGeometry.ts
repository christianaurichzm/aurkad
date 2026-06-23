import { TILE_SIZE } from './constants.js';
import { Tile } from './types.js';

export const mapTileWidth = (tiles: Tile[][]): number => tiles[0]?.length ?? 0;
export const mapTileHeight = (tiles: Tile[][]): number => tiles.length;
export const mapPixelWidth = (tiles: Tile[][]): number =>
  mapTileWidth(tiles) * TILE_SIZE;
export const mapPixelHeight = (tiles: Tile[][]): number =>
  mapTileHeight(tiles) * TILE_SIZE;
