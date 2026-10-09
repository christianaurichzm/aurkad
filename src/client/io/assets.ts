import { z } from 'zod';
import { MAX_ISOMETRIC_OVERHANG, TILE_SIZE } from '../../shared/constants';
import { SHEETS } from '../../shared/mappings';
import { buildEntityAtlas } from '../graphics/atlas';
import { parseSpriteLayout, setSpriteLayout } from '../graphics/sprite';

export let tileset: ImageBitmap;
export let tilesetAlpha: HTMLCanvasElement;
/**
 * tiles.png's alpha, a byte per pixel, kept while the atlas has frames.
 * Overlap with the player is read here: every prop is drawn from
 * tilesetAlpha, and reading it back more than once can move it off the GPU.
 */
export let tilesetOpacity: Uint8Array | null = null;
export let spriteSheet: ImageBitmap;
export let items: ImageBitmap;
export let spellSheet: HTMLCanvasElement;
export let arrowSheet: HTMLCanvasElement;
export let attackEffectSheet: HTMLCanvasElement;

const cellIndex = z.number().int().min(0).max(63);

/**
 * What a kit atlas says about a frame, so the map editor offers pieces to
 * place instead of raw cells. Frames sharing `name` are one piece; those
 * sharing `variant` are placed together, each `at` cells from the drop point.
 *
 * - `ground` goes on tileIndex and repeats with the map: cell (c, r) takes
 *   frame (c mod width, r mod height), so a seamless texture covers any area.
 * - `object` goes on maskIndex, all its cells at once.
 * - `decal` goes on maskIndex too but lies flat, like a path or a pond, so
 *   every actor is drawn over it.
 * - `connect` joins a piece to its own kind on the next cells, like a fence.
 *   The frame drawn is the one whose bits name the matching neighbours: 1
 *   above, 2 right, 4 below, 8 left. Water also reads corners, 16 above
 *   right, 32 below right, 64 below left, 128 above left, each only with
 *   both its sides set; a piece without corner frames draws by its sides.
 */
const PieceSchema = z.object({
  name: z.string().min(1).max(64),
  group: z.string().max(64).optional(),
  layer: z.enum(['ground', 'object', 'decal']).default('object'),
  at: z.tuple([cellIndex, cellIndex]).default([0, 0]),
  variant: z.number().int().min(0).max(255).default(0),
  connect: z.number().int().min(0).max(255).optional(),
  blocks: z.boolean().default(false),
});

// Frames are in tiles.png; anchors are offsets from the projected cell center.
const FrameSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  drawWidth: z.number().positive().max(MAX_ISOMETRIC_OVERHANG),
  drawHeight: z.number().positive().max(MAX_ISOMETRIC_OVERHANG),
  anchorX: z.number().min(0).max(MAX_ISOMETRIC_OVERHANG),
  anchorY: z.number().min(0).max(MAX_ISOMETRIC_OVERHANG),
  piece: PieceSchema.optional(),
});
export let isometricFrames: Record<string, z.infer<typeof FrameSchema>> = {};
// How far from its cell's center a frame can be drawn. The renderer scans
// this far past the screen, so a tall prop with its cell off screen shows.
export let isometricReach = TILE_SIZE;

/**
 * tiles.json `animations`: a tile id drawn as each of `frames` in turn, `ms`
 * apiece, for water or a torch. Every cell with the id shows the same frame,
 * so joined pieces stay joined.
 */
const AnimationSchema = z.object({
  frames: z.array(z.number().int().nonnegative()).min(1).max(256),
  ms: z.number().int().min(16).max(60_000),
});
export let tileAnimations: Record<string, z.infer<typeof AnimationSchema>> = {};

async function loadSheet(name: (typeof SHEETS)[number]): Promise<ImageBitmap> {
  const res = await fetch(`assets/${name}.png`);
  if (!res.ok) throw new Error(`Failed to fetch ${name}: ${res.status}`);
  return createImageBitmap(await res.blob());
}

function makeColorKeyCanvas(bitmap: ImageBitmap): {
  canvas: HTMLCanvasElement;
  pixels: Uint8ClampedArray;
} {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imageData.data;
  if (d[3] === 0) return { canvas, pixels: d };
  const bgR = d[0],
    bgG = d[1],
    bgB = d[2];
  for (let i = 0; i < d.length; i += 4) {
    if (
      Math.abs(d[i] - bgR) <= 2 &&
      Math.abs(d[i + 1] - bgG) <= 2 &&
      Math.abs(d[i + 2] - bgB) <= 2
    ) {
      d[i + 3] = 0;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return { canvas, pixels: d };
}

export const initTileset = async () => {
  tileset = await loadSheet('tiles');
  const keyed = makeColorKeyCanvas(tileset);
  tilesetAlpha = keyed.canvas;
  const response = await fetch('/assets/tiles.json');
  if (!response.ok) throw new Error(`Atlas metadata: HTTP ${response.status}`);
  const { animations, ...frames } = (await response.json()) as Record<
    string,
    unknown
  >;
  isometricFrames = z
    .record(z.string().regex(/^\d+$/), FrameSchema)
    .parse(frames);
  tileAnimations = z
    .record(z.string().regex(/^\d+$/), AnimationSchema)
    .parse(animations ?? {});
  for (const frame of Object.values(isometricFrames)) {
    if (
      frame.x + frame.width > tileset.width ||
      frame.y + frame.height > tileset.height
    )
      throw new Error('Isometric frame outside tiles.png');
  }
  tilesetOpacity = null;
  if (Object.keys(isometricFrames).length > 0) {
    tilesetOpacity = new Uint8Array(keyed.pixels.length / 4);
    for (let i = 0; i < tilesetOpacity.length; i++)
      tilesetOpacity[i] = keyed.pixels[i * 4 + 3];
  }
  isometricReach = Math.max(
    TILE_SIZE,
    ...Object.values(isometricFrames).map((f) =>
      Math.max(
        f.anchorX,
        f.drawWidth - f.anchorX,
        f.anchorY,
        f.drawHeight - f.anchorY,
      ),
    ),
  );
  return tileset;
};

export const initSpriteSheet = async () => {
  spriteSheet = await loadSheet('sprites');
  const response = await fetch('/assets/sprites.json');
  if (!response.ok) throw new Error(`Sprite metadata: HTTP ${response.status}`);
  setSpriteLayout(parseSpriteLayout(await response.json()));
  return spriteSheet;
};

export const initItems = async () => {
  items = await loadSheet('items');
  return items;
};

const initSpellSheet = async () => {
  const bmp = await loadSheet('spells');
  spellSheet = makeColorKeyCanvas(bmp).canvas;
};

const initArrowSheet = async () => {
  const bmp = await loadSheet('arrows');
  arrowSheet = makeColorKeyCanvas(bmp).canvas;
};

const initAttackEffectSheet = async () => {
  const bmp = await loadSheet('attackeffect');
  attackEffectSheet = makeColorKeyCanvas(bmp).canvas;
};

export const initializeAssets = async () => {
  // allSettled, so the atlas is built from whatever arrived. With all, one
  // sheet missing from the install would leave no atlas, and every player and
  // NPC would draw as just a name and a health bar.
  const results = await Promise.allSettled([
    initTileset(),
    initSpriteSheet(),
    initItems(),
    initSpellSheet(),
    initArrowSheet(),
    initAttackEffectSheet(),
  ]);
  for (const result of results) {
    if (result.status === 'rejected')
      console.error('[assets] sheet not loaded', result.reason);
  }
  buildEntityAtlas({
    sprites: spriteSheet,
    items,
    spells: spellSheet,
    arrows: arrowSheet,
    attackEffect: attackEffectSheet,
  });
  return { tileset, spriteSheet };
};
