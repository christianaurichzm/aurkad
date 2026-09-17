export const SPRITE_WIDTH = 64;
export const SPRITE_HEIGHT = 64;
export const TILE_SIZE = 64;
// Cell size of items.png, and so the size an icon is drawn at. No stored
// coordinate is measured in it (a sprite id is a grid index), so it follows
// the art pack. It has to divide the sheet width exactly, or every icon
// after the first row is sliced from the wrong place.
export const ITEM_SIZE = 64;
export const DEFAULT_PLAYER_SPEED = 1;
// 2ms below server cadence (250ms) so each slide drains before the next tick.
export const MOVEMENT_DURATION = 248;
export const RUN_MOVEMENT_DURATION = 148;
export const TICK_RATE = 20;
export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 896;
export const CHUNK_SIZE = 16;
export const PLAYER_ATTACK_COOLDOWN_MS = 250;
export const EQUIPMENT_SLOTS = [
  'weapon',
  'helmet',
  'chestplate',
  'gloves',
  'boots',
] as const;

// Shortest password the server will store when one is being set or reset. Here
// rather than in either half because both need the same number: the schema
// that refuses it, and the screen that says so before the round trip.
export const PASSWORD_MIN_LENGTH = 8;
