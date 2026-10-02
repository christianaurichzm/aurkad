/**
 * `npm run new-game -- <folder>`, or the `new-game` service of
 * compose.game.yml: a game folder that boots into something to walk
 * around in (one map, a few monsters, loot, placeholder art in every sheet
 * the client asks for), so a creator starts from a working game. Point
 * GAME_DIR at the folder. Compiled with the server so the image can run
 * it without the dev toolchain.
 *
 * The engine ships no art (assets/ is the operator's and stays out of
 * git), so the placeholders are drawn here in code, on the grids the client
 * slices: nothing to license, nothing binary in the repository.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { deflateSync } from 'node:zlib';
import {
  ITEM_SIZE,
  SPRITE_HEIGHT,
  SPRITE_WIDTH,
  TILE_SIZE,
} from '../../shared/constants.js';
import {
  Direction,
  type MapOrientation,
  type Tile,
} from '../../shared/types.js';

// --- PNG, from the standard library ----------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

export function encodePng(sheet: Sheet): Buffer {
  const stride = sheet.width * 4;
  // Each scanline is prefixed with its filter type; 0 is "none".
  const raw = Buffer.alloc((stride + 1) * sheet.height);
  for (let y = 0; y < sheet.height; y++) {
    sheet.px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(sheet.width, 0);
  header.writeUInt32BE(sheet.height, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Drawing ---------------------------------------------------------------

export class Sheet {
  readonly px: Buffer;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.px = Buffer.alloc(width * height * 4);
  }

  cell(index: number, size: number): Cell {
    const cols = this.width / size;
    return this.cellAt(
      (index % cols) * size,
      Math.floor(index / cols) * size,
      size,
    );
  }

  cellAt(x0: number, y0: number, size: number): Cell {
    return new Cell(this, x0, y0, size);
  }
}

// Shapes are clipped to their cell, so one that spills over never bleeds into
// the neighbouring frame. Colours are 0xRRGGBB; alpha 0 erases.
class Cell {
  constructor(
    private readonly sheet: Sheet,
    private readonly x0: number,
    private readonly y0: number,
    readonly size: number,
  ) {}

  dot(x: number, y: number, hex: number, alpha = 255): void {
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px < 0 || py < 0 || px >= this.size || py >= this.size) return;
    const i = ((this.y0 + py) * this.sheet.width + this.x0 + px) * 4;
    this.sheet.px.writeUInt32BE((((hex & 0xffffff) << 8) | alpha) >>> 0, i);
  }

  rect(x: number, y: number, w: number, h: number, hex: number, alpha = 255) {
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) this.dot(i, j, hex, alpha);
  }

  oval(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    hex: number,
    alpha = 255,
  ) {
    for (let j = Math.floor(cy - ry); j <= cy + ry; j++)
      for (let i = Math.floor(cx - rx); i <= cx + rx; i++) {
        const dx = (i + 0.5 - cx) / rx;
        const dy = (j + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.dot(i, j, hex, alpha);
      }
  }

  /** Degrees clockwise from east, since y grows downwards. */
  ring(
    cx: number,
    cy: number,
    r: number,
    thickness: number,
    hex: number,
    alpha = 255,
    from = 0,
    to = 360,
  ) {
    for (let j = Math.floor(cy - r); j <= cy + r; j++)
      for (let i = Math.floor(cx - r); i <= cx + r; i++) {
        const dx = i + 0.5 - cx;
        const dy = j + 0.5 - cy;
        const d = Math.hypot(dx, dy);
        const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
        if (d <= r && d >= r - thickness && angle >= from && angle <= to)
          this.dot(i, j, hex, alpha);
      }
  }
}

const shade = (hex: number, f: number): number => {
  const ch = (shift: number) =>
    Math.min(255, Math.round(((hex >> shift) & 0xff) * f));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

// Seeded, so a rerun writes the same files and the same map.
type Rand = () => number;
const seeded = (seed: number): Rand => {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
};

const specks = (c: Cell, r: Rand, hex: number, count: number) => {
  for (let n = 0; n < count; n++)
    c.rect(Math.floor(r() * c.size), Math.floor(r() * c.size), 2, 2, hex);
};

const ground =
  (base: number, ...speckles: number[]) =>
  (c: Cell, r: Rand) => {
    c.rect(0, 0, c.size, c.size, base);
    for (const hex of speckles) specks(c, r, hex, 24);
  };

const blocks =
  (fill: number, mortar: number, bw: number, bh: number) => (c: Cell) => {
    c.rect(0, 0, c.size, c.size, mortar);
    for (let y = 0; y < c.size; y += bh)
      for (let x = (y / bh) % 2 ? -bw / 2 : 0; x < c.size; x += bw) {
        c.rect(x + 1, y + 1, bw - 2, bh - 2, fill);
        c.rect(x + 1, y + 1, bw - 2, 2, shade(fill, 1.15));
      }
  };

const shadow = (c: Cell, rx: number) => c.oval(32, 58, rx, 4, 0x000000, 70);

// --- Tiles: TILE_SIZE cells, eight to a row ---------------------------------

// Cell 0 stays transparent: the client colour-keys the sheet on its first
// pixel for the mask and fringe layers, and a transparent one turns that off.
export const TILE = {
  empty: 0,
  grass: 1,
  grassTufts: 2,
  dirt: 3,
  sand: 4,
  water: 5,
  wall: 6,
  floor: 7,
  tree: 8,
  bush: 9,
  rock: 10,
  flowers: 11,
  cobble: 12,
  snow: 13,
  darkGrass: 14,
  brick: 15,
} as const;

const grass = ground(0x5a9e3c, 0x6fb84a, 0x4a8a30);

const TILE_ART: ((c: Cell, r: Rand) => void)[] = [
  () => {},
  grass,
  (c, r) => {
    grass(c, r);
    for (let n = 0; n < 6; n++) {
      const x = 6 + Math.floor(r() * 50);
      const y = 8 + Math.floor(r() * 46);
      for (let k = 0; k < 3; k++)
        c.rect(x + k * 2, y - (k % 2) * 2, 1, 5, 0x3f7a28);
    }
  },
  ground(0xa67c52, 0x8c6440, 0xb88d60),
  ground(0xdcc890, 0xc9b27a, 0xe8d8a8),
  (c, r) => {
    c.rect(0, 0, c.size, c.size, 0x3a78c8);
    for (let n = 0; n < 7; n++)
      c.rect(Math.floor(r() * 52), 6 + n * 8, 10, 2, 0x6ea0e0);
  },
  blocks(0x7a7a82, 0x55555c, 32, 16),
  (c) => {
    c.rect(0, 0, c.size, c.size, 0xa0703c);
    for (let x = 0; x < c.size; x += 16) c.rect(x, 0, 1, c.size, 0x7a5028);
    for (let x = 8; x < c.size; x += 16)
      c.rect(x - 2, (x * 7) % 48, 4, 3, 0x86582c);
  },
  (c) => {
    shadow(c, 16);
    c.rect(28, 38, 8, 20, 0x6b4423);
    c.oval(32, 26, 24, 22, 0x2f7a2f);
    c.oval(25, 19, 10, 8, 0x3f9a3f);
  },
  (c) => {
    shadow(c, 18);
    c.oval(32, 44, 20, 14, 0x3a8a34);
    c.oval(26, 39, 8, 5, 0x52a84a);
    for (const [x, y] of [
      [24, 46],
      [38, 42],
      [33, 50],
    ] as const)
      c.rect(x, y, 3, 3, 0xc03030);
  },
  (c) => {
    shadow(c, 20);
    c.oval(32, 44, 20, 14, 0x8a8a8a);
    c.oval(26, 38, 8, 5, 0xaaaaaa);
    c.rect(36, 42, 6, 1, 0x5a5a5a);
    c.rect(40, 43, 1, 6, 0x5a5a5a);
  },
  (c, r) => {
    const petals = [0xe04848, 0xf0d040, 0xffffff, 0xc070e0];
    for (let n = 0; n < 7; n++) {
      const x = 6 + Math.floor(r() * 50);
      const y = 8 + Math.floor(r() * 46);
      c.rect(x + 1, y + 3, 1, 5, 0x3f7a28);
      c.rect(x, y, 3, 3, petals[n % petals.length]!);
    }
  },
  (c, r) => {
    c.rect(0, 0, c.size, c.size, 0x5e5e5e);
    for (let y = 8; y < c.size; y += 16)
      for (let x = 8; x < c.size; x += 16)
        c.oval(x + (y % 32 ? 0 : 4), y, 7, 6, shade(0x8c8c8c, 0.9 + r() * 0.2));
  },
  ground(0xeef2f8, 0xd4deea, 0xffffff),
  ground(0x3f7a2c, 0x4a8a34, 0x356a24),
  blocks(0x9a4a3a, 0x6a3228, 16, 8),
];

export function drawTiles(): Sheet {
  const sheet = new Sheet(8 * TILE_SIZE, 2 * TILE_SIZE);
  const r = seeded(1);
  TILE_ART.forEach((draw, i) => draw(sheet.cell(i, TILE_SIZE), r));
  return sheet;
}

// --- Characters: a 4x4 block per character, eight to a row -----------------
// Rows are the facing (Direction: down, left, right, up), columns the walk
// cycle (graphics/sprite.ts); the attack pose reuses column 2.

type Look = {
  skin: number;
  hair: number;
  body: number;
  legs: number;
  hat?: number;
  robe?: boolean;
};

const EYES = 0x202020;

function humanoid(c: Cell, look: Look, dir: Direction, frame: number) {
  // Frames 1 and 3 lift one foot each; 0 and 2 stand.
  const step = frame === 1 ? -1 : frame === 3 ? 1 : 0;
  const sleeve = shade(look.body, 0.8);
  shadow(c, 14);
  if (look.robe) {
    c.rect(21, 28, 22, 22, look.body);
    c.rect(21 + step * 2, 50, 22, 7, look.body);
  } else {
    c.rect(24, 44, 7, step < 0 ? 10 : 13, look.legs);
    c.rect(33, 44, 7, step > 0 ? 10 : 13, look.legs);
    c.rect(22, 28, 20, 18, look.body);
    c.rect(22, 42, 20, 2, shade(look.body, 0.6));
  }
  if (dir === Direction.Left || dir === Direction.Right) {
    c.rect(29 + step * 3, 30, 6, 13, sleeve);
    c.rect(29 + step * 3, 43, 6, 3, look.skin);
  } else {
    c.rect(16, 29, 6, 14, sleeve);
    c.rect(42, 29, 6, 14, sleeve);
    c.rect(16, 43, 6, 3, look.skin);
    c.rect(42, 43, 6, 3, look.skin);
  }
  c.oval(32, 19, 11, 11, look.skin);
  if (dir === Direction.Up) c.oval(32, 19, 11, 11, look.hair);
  else c.oval(32, 13, 11, 6, look.hair);
  if (dir === Direction.Left) c.rect(36, 12, 7, 10, look.hair);
  if (dir === Direction.Right) c.rect(21, 12, 7, 10, look.hair);
  if (dir === Direction.Down) {
    c.rect(27, 19, 2, 3, EYES);
    c.rect(35, 19, 2, 3, EYES);
  }
  if (dir === Direction.Left) c.rect(24, 19, 2, 3, EYES);
  if (dir === Direction.Right) c.rect(38, 19, 2, 3, EYES);
  if (look.hat !== undefined) {
    c.rect(18, 9, 28, 3, look.hat);
    for (let i = 0; i < 10; i++) c.rect(22 + i, 8 - i, 20 - 2 * i, 1, look.hat);
  }
}

function slime(c: Cell, color: number, dir: Direction, frame: number) {
  const squash = [0, 2, 0, -2][frame] ?? 0;
  const rx = 18 + squash;
  const ry = 14 - squash;
  const cy = 57 - ry;
  shadow(c, rx);
  c.oval(32, cy, rx, ry, color);
  c.oval(26, cy - ry / 2, 5, 3, shade(color, 1.4));
  if (dir === Direction.Down) {
    c.rect(26, cy - 2, 3, 4, EYES);
    c.rect(35, cy - 2, 3, 4, EYES);
  }
  if (dir === Direction.Left) c.rect(22, cy - 2, 3, 4, EYES);
  if (dir === Direction.Right) c.rect(39, cy - 2, 3, 4, EYES);
}

const SKIN = 0xf0c8a0;
const BONE = 0xe8e4d4;

// Sprite 0 is what every new character is created with.
export const SPRITE = {
  hero: 0,
  mage: 1,
  ranger: 2,
  villager: 3,
  merchant: 4,
  skeleton: 5,
  slime: 6,
  redSlime: 7,
} as const;

const CHARACTERS: ((c: Cell, dir: Direction, frame: number) => void)[] = [
  (c, d, f) =>
    humanoid(
      c,
      { skin: SKIN, hair: 0x6a4020, body: 0x3a6ac8, legs: 0x3a3a50 },
      d,
      f,
    ),
  (c, d, f) =>
    humanoid(
      c,
      {
        skin: SKIN,
        hair: 0xc0c0c0,
        body: 0x7040a0,
        legs: 0x7040a0,
        hat: 0x5a2a88,
        robe: true,
      },
      d,
      f,
    ),
  (c, d, f) =>
    humanoid(
      c,
      { skin: SKIN, hair: 0xc08030, body: 0x3a7a3a, legs: 0x5a4020 },
      d,
      f,
    ),
  (c, d, f) =>
    humanoid(
      c,
      { skin: SKIN, hair: 0x3a2a1a, body: 0xa08050, legs: 0x6a5030 },
      d,
      f,
    ),
  (c, d, f) =>
    humanoid(
      c,
      { skin: SKIN, hair: 0x202020, body: 0xc89a30, legs: 0x5a3a20 },
      d,
      f,
    ),
  (c, d, f) =>
    humanoid(
      c,
      { skin: BONE, hair: BONE, body: 0xd0cab8, legs: 0xd0cab8 },
      d,
      f,
    ),
  (c, d, f) => slime(c, 0x4cb84c, d, f),
  (c, d, f) => slime(c, 0xd04a4a, d, f),
];

export function drawSprites(): Sheet {
  const sheet = new Sheet(
    CHARACTERS.length * 4 * SPRITE_WIDTH,
    4 * SPRITE_HEIGHT,
  );
  CHARACTERS.forEach((draw, index) => {
    for (let dir = 0; dir < 4; dir++)
      for (let frame = 0; frame < 4; frame++)
        draw(
          sheet.cellAt(
            (index * 4 + frame) * SPRITE_WIDTH,
            dir * SPRITE_HEIGHT,
            SPRITE_WIDTH,
          ),
          dir,
          frame,
        );
  });
  return sheet;
}

// --- Items: ITEM_SIZE cells ------------------------------------------------

const potion = (color: number) => (c: Cell) => {
  c.oval(32, 40, 13, 13, color);
  c.oval(27, 36, 3, 4, shade(color, 1.5));
  c.rect(28, 20, 8, 10, 0xd0e0f0);
  c.rect(27, 16, 10, 5, 0x8a6030);
};

const STEEL = 0x9aa0a8;

export const ITEM_SPRITE = {
  potion: 0,
  manaPotion: 1,
  coin: 2,
  sword: 3,
  helmet: 4,
  chestplate: 5,
  boots: 6,
  bow: 7,
} as const;

const ITEM_ART: ((c: Cell) => void)[] = [
  potion(0xd03a3a),
  potion(0x3a5ad0),
  (c) => {
    c.oval(32, 34, 13, 13, 0xd0a020);
    c.oval(32, 34, 9, 9, 0xf0c850);
    c.rect(31, 28, 2, 12, 0xc09020);
  },
  (c) => {
    c.rect(30, 10, 5, 32, 0xd0d8e0);
    c.rect(30, 10, 2, 32, 0xf0f4f8);
    c.rect(22, 42, 21, 4, 0xa07030);
    c.rect(30, 46, 5, 9, 0x6a4020);
    c.oval(32.5, 57, 3, 3, 0xa07030);
  },
  (c) => {
    c.oval(32, 38, 15, 15, STEEL);
    c.rect(16, 40, 32, 14, 0, 0);
    c.rect(16, 36, 32, 4, shade(STEEL, 0.7));
    c.rect(24, 30, 16, 3, 0x303030);
  },
  (c) => {
    c.rect(16, 18, 32, 6, STEEL);
    c.rect(20, 18, 24, 28, STEEL);
    c.oval(32, 18, 6, 4, 0, 0);
    c.rect(31, 24, 2, 20, shade(STEEL, 0.7));
  },
  (c) => {
    for (const x of [16, 34]) {
      c.rect(x, 20, 10, 22, 0x7a4a28);
      c.rect(x, 40, 15, 6, 0x7a4a28);
      c.rect(x, 20, 10, 3, 0x5a3418);
    }
  },
  (c) => {
    c.ring(40, 32, 20, 3, 0x8a5a2a, 255, 90, 270);
    c.rect(40, 12, 1, 40, 0xe0e0e0);
  },
];

export function drawItems(): Sheet {
  const sheet = new Sheet(ITEM_ART.length * ITEM_SIZE, ITEM_SIZE);
  ITEM_ART.forEach((draw, i) => draw(sheet.cell(i, ITEM_SIZE)));
  return sheet;
}

// --- Spells, arrows and the melee swing ------------------------------------

// Both 32px grids are fixed in the client (spellEffect.ts, projectiles.ts).
const SPELL_CELL = 32;
const ARROW_CELL = 32;

// Four-frame bursts, one per row half: a spell names its first cell and a
// frame count of 4. Fire 0, ice 4, heal 8, shock 12.
export function drawSpells(): Sheet {
  const sheet = new Sheet(8 * SPELL_CELL, 2 * SPELL_CELL);
  [0xf07020, 0x60c0f0, 0x60e070, 0xf0e040].forEach((color, s) => {
    const at = (frame: number) => sheet.cell(s * 4 + frame, SPELL_CELL);
    at(0).oval(16, 16, 5, 5, color);
    at(0).oval(16, 16, 2, 2, 0xffffff);
    at(1).oval(16, 16, 9, 9, color, 220);
    at(1).oval(16, 16, 4, 4, shade(color, 1.4));
    at(2).ring(16, 16, 13, 4, color, 200);
    at(3).ring(16, 16, 15, 2, color, 110);
  });
  return sheet;
}

// One arrow per row of four, in the client's order: down, up, right, left.
export function drawArrows(): Sheet {
  const sheet = new Sheet(4 * ARROW_CELL, ARROW_CELL);
  const headings: [number, number][] = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ];
  headings.forEach(([dx, dy], i) => {
    const c = sheet.cell(i, ARROW_CELL);
    // t runs along the shaft, s across it.
    const at = (t: number, s: number, hex: number) =>
      c.dot(16 + t * dx - s * dy, 16 + t * dy + s * dx, hex);
    for (let t = -12; t <= 7; t++) for (const s of [0, 1]) at(t, s, 0x8a5a2a);
    for (let t = 7; t <= 12; t++)
      for (let s = t - 12; s <= 13 - t; s++) at(t, s, 0xc0c8d0);
    for (let t = -13; t <= -9; t++)
      for (const s of [-2, -1, 2, 3]) at(t, s, 0xd04040);
  });
  return sheet;
}

// Six frames of a swing drawn a tile ahead of the attacker, whichever
// way it faces (graphics/attackEffect.ts).
export function drawAttackEffect(): Sheet {
  const sheet = new Sheet(6 * TILE_SIZE, TILE_SIZE);
  const spans = [50, 100, 140, 140, 140, 140];
  const alphas = [255, 255, 255, 200, 130, 60];
  spans.forEach((span, f) => {
    const c = sheet.cell(f, TILE_SIZE);
    c.ring(32, 40, 24, 5, 0xffffff, alphas[f], 200, 200 + span);
    c.ring(32, 40, 19, 2, 0xa0d0ff, alphas[f], 200, 200 + span);
  });
  return sheet;
}

// --- Content ---------------------------------------------------------------

export const MAP_COLS = 32;
export const MAP_ROWS = 22;
export const RESPAWN = { col: 9, row: 6 };

const NPC_SPAWNS: [string, number, number][] = [
  ['slime', 18, 15],
  ['slime', 23, 17],
  ['slime', 27, 14],
  ['slime', 15, 18],
  ['red-slime', 27, 19],
  ['skeleton', 5, 17],
  ['villager', 12, 4],
];

export function buildMap(orientation: MapOrientation = 'orthogonal') {
  const r = seeded(7);
  const tiles: Tile[][] = [];
  for (let row = 0; row < MAP_ROWS; row++) {
    const line: Tile[] = [];
    for (let col = 0; col < MAP_COLS; col++) {
      const edge =
        row === 0 || col === 0 || row === MAP_ROWS - 1 || col === MAP_COLS - 1;
      const pond = ((col - 24) / 4.5) ** 2 + ((row - 6) / 3.2) ** 2;
      const onPath = row === 11 || (col === RESPAWN.col && row < 11);
      line.push(
        edge
          ? // Ground is sheared flat on an isometric map, where the wall
            // would read as paving; a tree stands up off its cell.
            orientation === 'isometric'
            ? { tileIndex: TILE.grass, maskIndex: TILE.tree, blocked: true }
            : { tileIndex: TILE.wall, blocked: true }
          : pond <= 1
            ? { tileIndex: TILE.water, blocked: true }
            : pond <= 1.6
              ? { tileIndex: TILE.sand }
              : onPath
                ? { tileIndex: TILE.dirt }
                : { tileIndex: r() < 0.12 ? TILE.grassTufts : TILE.grass },
      );
    }
    tiles.push(line);
  }
  for (const [id, col, row] of NPC_SPAWNS) tiles[row]![col]!.npcSpawn = id;

  // Props only on open grass, clear of the spawn point and the npcs.
  for (let n = 0; n < 90; n++) {
    const col = 1 + Math.floor(r() * (MAP_COLS - 2));
    const row = 1 + Math.floor(r() * (MAP_ROWS - 2));
    const tile = tiles[row]![col]!;
    const open =
      tile.tileIndex === TILE.grass || tile.tileIndex === TILE.grassTufts;
    const nearSpawn =
      Math.abs(col - RESPAWN.col) <= 2 && Math.abs(row - RESPAWN.row) <= 2;
    if (!open || nearSpawn || tile.npcSpawn || tile.maskIndex !== undefined)
      continue;
    const roll = r();
    if (roll < 0.4)
      Object.assign(tile, { maskIndex: TILE.tree, blocked: true });
    else if (roll < 0.55)
      Object.assign(tile, { maskIndex: TILE.rock, blocked: true });
    else if (roll < 0.7) tile.maskIndex = TILE.bush;
    else tile.maskIndex = TILE.flowers;
  }
  return { id: '1', name: 'Meadow', type: 'normal', orientation, tiles };
}

export const ITEMS = [
  {
    id: 1,
    name: 'Health Potion',
    description: 'A red draught that closes wounds.',
    sprite: ITEM_SPRITE.potion,
    type: 'consumable',
    effects: [{ attribute: 'health', type: 'add', value: 30 }],
  },
  {
    id: 2,
    name: 'Gold Coin',
    description: 'Currency.',
    sprite: ITEM_SPRITE.coin,
    type: 'money',
  },
  {
    id: 3,
    name: 'Short Sword',
    description: 'Light and quick to draw.',
    sprite: ITEM_SPRITE.sword,
    type: 'weapon',
    effects: [{ attribute: 'attack', type: 'add', value: 3 }],
  },
  {
    id: 4,
    name: 'Iron Helmet',
    description: 'A solid iron helmet.',
    sprite: ITEM_SPRITE.helmet,
    type: 'helmet',
    effects: [{ attribute: 'defense', type: 'add', value: 2 }],
  },
  {
    id: 5,
    name: 'Leather Boots',
    description: 'Soft soles for a quick step.',
    sprite: ITEM_SPRITE.boots,
    type: 'boots',
    effects: [{ attribute: 'agility', type: 'add', value: 1 }],
  },
];

// The slimes sit within a few tiles of each other, and an aggressive npc
// notices a player 8 tiles away through walls, so a whole field would pile onto
// a level-one player. Hostile ones only react to what they see nearby; the
// skeleton stands alone, so it can be the one that hunts.
export const NPCS = [
  {
    id: 'slime',
    name: 'Slime',
    sprite: SPRITE.slime,
    maxHealth: 20,
    attack: 2,
    behavior: 'hostile',
    experienceValue: 10,
    itemsToDrop: [
      { itemId: 2, chance: 0.8, quantity: 3 },
      { itemId: 1, chance: 0.2, quantity: 1 },
    ],
  },
  {
    id: 'red-slime',
    name: 'Red Slime',
    sprite: SPRITE.redSlime,
    maxHealth: 45,
    attack: 6,
    behavior: 'hostile',
    experienceValue: 25,
    itemsToDrop: [
      { itemId: 2, chance: 1, quantity: 5 },
      { itemId: 3, chance: 0.15, quantity: 1 },
      { itemId: 5, chance: 0.15, quantity: 1 },
    ],
  },
  {
    id: 'skeleton',
    name: 'Skeleton',
    sprite: SPRITE.skeleton,
    maxHealth: 60,
    attack: 8,
    behavior: 'aggressive',
    experienceValue: 40,
    itemsToDrop: [
      { itemId: 2, chance: 1, quantity: 8 },
      { itemId: 4, chance: 0.2, quantity: 1 },
    ],
  },
  {
    id: 'villager',
    name: 'Villager',
    sprite: SPRITE.villager,
    maxHealth: 50,
    attack: 0,
    behavior: 'friendly',
  },
];

const titleCase = (folder: string) =>
  folder
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .trim()
    .slice(0, 40);

// Every official module, switched off: the game starts as the engine alone,
// and its game.json lists what there is to turn on. Read from the engine's
// modules/ as the loader finds it, so a module added later is listed too.
function modulesOff(): Record<string, { enabled: false }> {
  const dir = process.env.MODULES_PATH ?? 'modules';
  if (!fs.existsSync(dir)) return {};
  return Object.fromEntries(
    fs
      .readdirSync(dir)
      .filter((id) => fs.existsSync(path.join(dir, id, 'module.json')))
      .map((id) => [id, { enabled: false }]),
  );
}

export function writeGame(
  dir: string,
  name = titleCase(path.basename(dir)) || 'New Game',
  orientation: MapOrientation = 'orthogonal',
): void {
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  const files: Record<string, string | Buffer> = {
    'game.json': json({
      brand: { name },
      world: { startMapId: '1', respawnTile: RESPAWN },
      modules: modulesOff(),
    }),
    'content/maps.json': `${JSON.stringify([buildMap(orientation)])}\n`,
    'content/npcs.json': json(NPCS),
    'content/items.json': json(ITEMS),
    'assets/tiles.png': encodePng(drawTiles()),
    'assets/sprites.png': encodePng(drawSprites()),
    'assets/items.png': encodePng(drawItems()),
    'assets/spells.png': encodePng(drawSpells()),
    'assets/arrows.png': encodePng(drawArrows()),
    'assets/attackeffect.png': encodePng(drawAttackEffect()),
  };
  for (const [rel, data] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  }
}

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { isometric: { type: 'boolean' } },
  });
  const [arg, name] = positionals;
  if (!arg) {
    console.error(
      'Usage: npm run new-game -- <folder> ["Game Name"] [--isometric]',
    );
    process.exit(1);
  }
  const dir = path.resolve(arg);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
    console.error(`${arg} already has files in it; pick a new folder.`);
    process.exit(1);
  }
  writeGame(dir, name, values.isometric ? 'isometric' : 'orthogonal');
  console.log(
    `Created ${arg}: one map, four kinds of npc, five items, and placeholder art to paint over.\n` +
      `Run the engine with GAME_DIR pointing at it; its name and logo are brand in game.json.\n` +
      `In development the first account registered is the admin; in production, the one named by BOOTSTRAP_ADMIN_USERNAME.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
