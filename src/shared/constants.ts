export const SPRITE_WIDTH = 64;
export const SPRITE_HEIGHT = 64;
export const TILE_SIZE = 64;
// An isometric map draws its square cell as a 2:1 diamond: the grid turned 45
// degrees and squashed. At 0.5 the diamond is TILE_SIZE wide, so an actor drawn
// one tile wide is as wide as the cell it stands on.
export const ISO_SCALE = 0.5;
// Most an isometric atlas frame may reach beyond its cell, in view pixels. The
// server streams that much extra around the viewport, so a tall prop whose
// cell is just off screen is already on the client when its top comes in.
export const MAX_ISOMETRIC_OVERHANG = 512;
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
