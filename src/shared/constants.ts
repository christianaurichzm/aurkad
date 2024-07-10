// shared/constants.ts
import { Position } from './types';

export const SPRITE_WIDTH = 64;
export const SPRITE_HEIGHT = 64;
export const TILE_SIZE = 64;
export const DEFAULT_PLAYER_SPEED = 10;
export const BOOST_MULTIPLIER = 150;
export const FIRST_GAME_MAP_ID = '1';
export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 896;
export const RESPAWN_POSITION: Position = {
  x: 9 * TILE_SIZE,
  y: 6 * TILE_SIZE,
};
