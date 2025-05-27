import { Position } from './types.js';

export const SPRITE_WIDTH = 64;
export const SPRITE_HEIGHT = 64;
export const TILE_SIZE = 64;
export const ITEM_SIZE = 48;
export const DEFAULT_PLAYER_SPEED = 1;
export const BOOST_MULTIPLIER = 1.5;
export const MOVEMENT_DURATION = 220;
export const RUN_MOVEMENT_DURATION = 130;
export const REGEN_PERCENT = 0.01;
export const MIN_REGEN = 1;
export const MOVE_STEP = 4;
export const FIRST_GAME_MAP_ID = '1';
export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 896;
export const RESPAWN_POSITION: Position = {
  x: 9 * TILE_SIZE,
  y: 6 * TILE_SIZE,
};
export const EQUIPMENT_SLOTS = [
  'weapon',
  'helmet',
  'chestplate',
  'gloves',
  'boots',
] as const;
