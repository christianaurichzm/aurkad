import { TILE_SIZE, ISO_SCALE } from '../../shared/constants';
import type { TilePublic } from '../../shared/types';
import {
  tileset,
  tilesetAlpha,
  tilesetOpacity,
  isometricFrames,
  isometricReach,
  tileAnimations,
} from '../io/assets';
import {
  foregroundCanvas,
  foregroundCtx,
  maskCtx,
  fringeCtx,
  prepareWorldContext,
  worldScale,
  worldCanvasGeneration,
} from './canvas';
import { getCamera, spritePosition, worldToView } from './camera';
import { getMapOrientation } from '../core/gameState';
import { viewBounds } from '../../shared/mapGeometry';

// The rows and columns the camera can see, so a pass costs the viewport
// rather than the whole map.
export const visibleRange = <T>(
  tiles: T[][],
  width: number,
  height: number,
  reach = isometricReach,
) => {
  const cam = getCamera();
  const bounds = viewBounds(
    cam.x,
    cam.y,
    width,
    height,
    getMapOrientation(),
    reach,
  );
  return {
    startCol: Math.max(0, Math.floor(bounds.left / TILE_SIZE)),
    endCol: Math.min(
      (tiles[0]?.length ?? 0) - 1,
      Math.ceil(bounds.right / TILE_SIZE),
    ),
    startRow: Math.max(0, Math.floor(bounds.top / TILE_SIZE)),
    endRow: Math.min(tiles.length - 1, Math.ceil(bounds.bottom / TILE_SIZE)),
  };
};

type Rect = { x: number; y: number; width: number; height: number };

/** The tile for `index` now: its animation's current frame, or itself. */
export const animatedTile = (index: number, now = performance.now()) => {
  const animation = tileAnimations[index];
  if (!animation) return index;
  const { frames, ms } = animation;
  return frames[Math.floor(now / ms) % frames.length] ?? index;
};

type Layer = 'tileIndex' | 'maskIndex' | 'fringeIndex';
const ALL_LAYERS: Layer[] = ['tileIndex', 'maskIndex', 'fringeIndex'];

/**
 * A number that changes when an animated tile on screen turns a frame and
 * never for one off it, so the cached layers repaint only when it shows.
 */
export const animationStep = (
  tiles: TilePublic[][],
  layers = ALL_LAYERS,
  now = performance.now(),
) => {
  if (Object.keys(tileAnimations).length === 0) return 0;
  const range = visibleRange(
    tiles,
    foregroundCanvas.width / worldScale,
    foregroundCanvas.height / worldScale,
  );
  const seen = new Set<number>();
  for (let row = range.startRow; row <= range.endRow; row++) {
    for (let col = range.startCol; col <= range.endCol; col++) {
      const tile = tiles[row]?.[col];
      if (!tile) continue;
      for (const layer of layers) {
        const index = tile[layer];
        if (index !== undefined && tileAnimations[index]) seen.add(index);
      }
    }
  }
  let step = 0;
  for (const index of seen)
    step += Math.floor(now / (tileAnimations[index]?.ms ?? 1));
  return step;
};

// The view pixels a ground tile covers: its frame on an isometric atlas, else
// its square, or the diamond that square is sheared into.
export const groundRect = (
  col: number,
  row: number,
  tileIndex: number,
): Rect => {
  if (frameOf(tileIndex)) return objectRect(col, row, tileIndex);
  const at = worldToView(col * TILE_SIZE, row * TILE_SIZE);
  return getMapOrientation() === 'isometric'
    ? { x: at.x - TILE_SIZE, y: at.y, width: 2 * TILE_SIZE, height: TILE_SIZE }
    : { x: at.x, y: at.y, width: TILE_SIZE, height: TILE_SIZE };
};

/**
 * One ground tile, in view pixels: the caller translates for the camera.
 * `clear` first erases the cell it covers - a square or its diamond; a frame
 * overlaps its neighbours, which a clear would cut into.
 */
export const drawGroundTile = (
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  col: number,
  row: number,
  tileIndex: number,
  clear = false,
) => {
  // A missing tiles sheet leaves the map undrawn rather than throwing and
  // ending the frame before the characters.
  if (!tileset) return;
  if (frameOf(tileIndex)) {
    drawMapObject(ctx, col, row, tileIndex, tileset);
    return;
  }
  const at = worldToView(col * TILE_SIZE, row * TILE_SIZE);
  const tilesPerRow = tileset.width / TILE_SIZE;
  ctx.save();
  ctx.translate(at.x, at.y);
  if (getMapOrientation() === 'isometric')
    ctx.transform(ISO_SCALE, ISO_SCALE / 2, -ISO_SCALE, ISO_SCALE / 2, 0, 0);
  if (clear) ctx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
  // Smoothed at a scale that splits a tile's edge across device pixels, edges
  // show as a dark grid. Each tile bleeds a device pixel into its right and
  // lower neighbours, which cover it.
  const bleed = ctx.imageSmoothingEnabled ? 1 / worldScale : 0;
  ctx.drawImage(
    tileset,
    (tileIndex % tilesPerRow) * TILE_SIZE,
    Math.floor(tileIndex / tilesPerRow) * TILE_SIZE,
    TILE_SIZE,
    TILE_SIZE,
    0,
    0,
    TILE_SIZE + bleed,
    TILE_SIZE + bleed,
  );
  ctx.restore();
};

/** Every ground tile that shows inside `area` (view pixels). */
const drawGround = (
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  tiles: TilePublic[][],
  area: Rect,
) => {
  const reach =
    getMapOrientation() === 'isometric' ? isometricReach : TILE_SIZE;
  const bounds = viewBounds(
    area.x,
    area.y,
    area.width,
    area.height,
    getMapOrientation(),
    reach,
  );
  const startRow = Math.max(0, Math.floor(bounds.top / TILE_SIZE));
  const endRow = Math.min(
    tiles.length - 1,
    Math.ceil(bounds.bottom / TILE_SIZE),
  );
  const startCol = Math.max(0, Math.floor(bounds.left / TILE_SIZE));
  const endCol = Math.min(
    (tiles[0]?.length ?? 0) - 1,
    Math.ceil(bounds.right / TILE_SIZE),
  );
  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      const index = tiles[row]?.[col]?.tileIndex;
      if (index === undefined || index === -1) continue;
      const tileIndex = animatedTile(index);
      const r = groundRect(col, row, tileIndex);
      if (
        r.x >= area.x + area.width ||
        r.x + r.width <= area.x ||
        r.y >= area.y + area.height ||
        r.y + r.height <= area.y
      )
        continue;
      drawGroundTile(ctx, col, row, tileIndex);
    }
  }
};

// The editor's copy, painted straight onto the screen: edits change it in
// place, so nothing about it says when a copy of it has gone stale.
export const drawTiles = (tiles: TilePublic[][]) => {
  // The editor's copy is empty until fetched, and the loop repaints only on
  // camera or map change, so clearing here would leave the world blank.
  if (!tiles.length) return;
  const cam = getCamera();
  const width = foregroundCanvas.width / worldScale;
  const height = foregroundCanvas.height / worldScale;
  foregroundCtx.clearRect(0, 0, width, height);
  foregroundCtx.save();
  foregroundCtx.translate(-cam.x, -cam.y);
  drawGround(foregroundCtx, tiles, { x: cam.x, y: cam.y, width, height });
  foregroundCtx.restore();
};

/**
 * The ground around the camera, painted once and copied from while the
 * camera stays inside it: one draw a frame instead of one per tile. The
 * margin is how far the camera goes before the next repaint.
 */
const GROUND_MARGIN = 256;
let groundCache: {
  canvas: OffscreenCanvas;
  tiles: TilePublic[][];
  atlas: ImageBitmap;
  frames: typeof isometricFrames;
  orientation: string | undefined;
  generation: number;
  step: number;
  x: number;
  y: number;
} | null = null;

const drawCachedTiles = (tiles: TilePublic[][]) => {
  if (!tiles.length) return;
  const cam = getCamera();
  const width = foregroundCanvas.width / worldScale;
  const height = foregroundCanvas.height / worldScale;
  let cache = groundCache;
  const step = animationStep(tiles, ['tileIndex']);
  if (
    !cache ||
    cache.tiles !== tiles ||
    cache.atlas !== tileset ||
    cache.frames !== isometricFrames ||
    cache.orientation !== getMapOrientation() ||
    cache.generation !== worldCanvasGeneration ||
    cache.step !== step ||
    cam.x < cache.x ||
    cam.y < cache.y ||
    cam.x + width > cache.x + cache.canvas.width / worldScale ||
    cam.y + height > cache.y + cache.canvas.height / worldScale
  ) {
    const w = Math.ceil((width + 2 * GROUND_MARGIN) * worldScale);
    const h = Math.ceil((height + 2 * GROUND_MARGIN) * worldScale);
    const canvas =
      cache?.canvas.width === w && cache.canvas.height === h
        ? cache.canvas
        : new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d')!;
    prepareWorldContext(ctx);
    ctx.clearRect(0, 0, w / worldScale, h / worldScale);
    const area = {
      x: cam.x - GROUND_MARGIN,
      y: cam.y - GROUND_MARGIN,
      width: w / worldScale,
      height: h / worldScale,
    };
    ctx.save();
    ctx.translate(-area.x, -area.y);
    drawGround(ctx, tiles, area);
    ctx.restore();
    cache = groundCache = {
      canvas,
      tiles,
      atlas: tileset,
      frames: isometricFrames,
      orientation: getMapOrientation(),
      generation: worldCanvasGeneration,
      step,
      x: area.x,
      y: area.y,
    };
  }
  foregroundCtx.clearRect(0, 0, width, height);
  foregroundCtx.drawImage(
    cache.canvas,
    (cam.x - cache.x) * worldScale,
    (cam.y - cache.y) * worldScale,
    width * worldScale,
    height * worldScale,
    0,
    0,
    width,
    height,
  );
};

/**
 * The map as the game draws it, run on every frame the camera crosses a
 * pixel, so it must not copy the map. The game's grid is replaced, never
 * mutated, so its identity keys the cache; the editor's copy is edited in
 * place, so `live` skips the cache.
 */
export const renderGameMap = (tiles: TilePublic[][], live = false) => {
  if (live) drawTiles(tiles);
  else drawCachedTiles(tiles);
};
const frameOf = (index: number) => isometricFrames[index];

// Where an object lands in view pixels: an isometric frame hangs from its
// anchor at the cell's centre, anything else fills its cell.
function objectRect(col: number, row: number, index: number) {
  const frame = frameOf(index);
  if (frame) {
    const foot = worldToView((col + 0.5) * TILE_SIZE, (row + 0.5) * TILE_SIZE);
    return {
      x: foot.x - frame.anchorX,
      y: foot.y - frame.anchorY,
      width: frame.drawWidth,
      height: frame.drawHeight,
    };
  }
  const at = spritePosition(col * TILE_SIZE, row * TILE_SIZE);
  return { x: at.x, y: at.y, width: TILE_SIZE, height: TILE_SIZE };
}

function drawMapObject(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  col: number,
  row: number,
  index: number,
  source: ImageBitmap | HTMLCanvasElement = tilesetAlpha,
) {
  if (!tileset) return;
  const frame = frameOf(index);
  const perRow = tileset.width / TILE_SIZE;
  const to = objectRect(col, row, index);
  ctx.drawImage(
    source,
    frame ? frame.x : (index % perRow) * TILE_SIZE,
    frame ? frame.y : Math.floor(index / perRow) * TILE_SIZE,
    frame ? frame.width : TILE_SIZE,
    frame ? frame.height : TILE_SIZE,
    to.x,
    to.y,
    to.width,
    to.height,
  );
}

type MapObject = {
  y: number;
  col: number;
  row: number;
  index: number;
  draw: () => void;
};

function mapObjects(
  tiles: TilePublic[][],
  layer: 'maskIndex' | 'fringeIndex',
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
) {
  const range = visibleRange(
    tiles,
    ctx.canvas.width / worldScale,
    ctx.canvas.height / worldScale,
  );
  const objects: MapObject[] = [];
  for (let row = range.startRow; row <= range.endRow; row++) {
    for (let col = range.startCol; col <= range.endCol; col++) {
      const placed = tiles[row]?.[col]?.[layer];
      if (placed === undefined) continue;
      const index = animatedTile(placed);
      objects.push({
        y: worldToView((col + 0.5) * TILE_SIZE, (row + 0.5) * TILE_SIZE).y,
        col,
        row,
        index,
        draw: () => drawMapObject(ctx, col, row, index),
      });
    }
  }
  return objects;
}

// Transparency of a prop standing between the camera and the player.
const SEE_THROUGH_ALPHA = 0.45;
// The part of a sprite frame the character fills: a prop grazing the frame's
// empty corners hides nothing.
const FIGURE_INSET = { x: 16, top: 12, bottom: 4 };
// A frame's pixel at least this opaque is the prop itself; its baked shadow is
// drawn translucent, below this.
const SOLID_ALPHA = 240;
const solidAt = (x: number, y: number) =>
  !tilesetOpacity || tilesetOpacity[y * tileset.width + x] >= SOLID_ALPHA;

/**
 * Whether a frame over `r` hides the figure in `box`, judged by its pixels
 * at a few points, since a frame's box includes its shadow.
 */
function frameHides(
  frame: { x: number; y: number; width: number; height: number },
  r: { x: number; y: number; width: number; height: number },
  box: { left: number; right: number; top: number; bottom: number },
) {
  for (let i = 1; i < 4; i++) {
    for (let j = 1; j < 5; j++) {
      const x = box.left + ((box.right - box.left) * i) / 4;
      const y = box.top + ((box.bottom - box.top) * j) / 5;
      if (x < r.x || y < r.y || x >= r.x + r.width || y >= r.y + r.height)
        continue;
      if (
        solidAt(
          Math.floor(frame.x + ((x - r.x) * frame.width) / r.width),
          Math.floor(frame.y + ((y - r.y) * frame.height) / r.height),
        )
      )
        return true;
    }
  }
  return false;
}

/**
 * Whether a mask object stands up off the ground: everything on an
 * isometric map, and on an orthogonal one a frame drawn past the top of its
 * cell. A decal lies flat on either.
 */
const stands = (index: number) => {
  const frame = frameOf(index);
  if (frame?.piece?.layer === 'decal') return false;
  if (getMapOrientation() === 'isometric') return true;
  return frame !== undefined && frame.anchorY > TILE_SIZE / 2;
};

/**
 * What stands on the mask layer, sorted in with the actors so a wall is in
 * front of whoever stands behind it. A prop covering `seen`, the player the
 * camera follows, is drawn faint.
 */
export const standingMapObjects = (
  tiles: TilePublic[][],
  ctx: CanvasRenderingContext2D,
  seen?: { x: number; y: number },
): MapObject[] => {
  const objects = mapObjects(tiles, 'maskIndex', ctx).filter((object) =>
    stands(object.index),
  );
  if (!seen) return objects;
  const depth = worldToView(seen.x + TILE_SIZE / 2, seen.y + TILE_SIZE / 2).y;
  const at = spritePosition(seen.x, seen.y);
  const box = {
    left: at.x + FIGURE_INSET.x,
    right: at.x + TILE_SIZE - FIGURE_INSET.x,
    top: at.y + FIGURE_INSET.top,
    bottom: at.y + TILE_SIZE - FIGURE_INSET.bottom,
  };
  return objects.map((object) => {
    if (object.y <= depth) return object;
    const r = objectRect(object.col, object.row, object.index);
    if (
      r.x >= box.right ||
      r.x + r.width <= box.left ||
      r.y >= box.bottom ||
      r.y + r.height <= box.top
    )
      return object;
    const frame = frameOf(object.index);
    if (frame && !frameHides(frame, r, box)) return object;
    return {
      ...object,
      draw: () => {
        ctx.save();
        ctx.globalAlpha = SEE_THROUGH_ALPHA;
        object.draw();
        ctx.restore();
      },
    };
  });
};

export const renderMapMask = (
  tiles: TilePublic[][],
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D = maskCtx,
) => {
  for (const object of mapObjects(tiles, 'maskIndex', ctx))
    if (!stands(object.index)) object.draw();
};

export const renderMapFringe = (
  tiles: TilePublic[][],
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D = fringeCtx,
) => {
  const objects = mapObjects(tiles, 'fringeIndex', ctx);
  objects.sort((a, b) => a.y - b.y);
  for (const object of objects) object.draw();
};
