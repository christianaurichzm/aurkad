import {
  getEl,
  getInputValue,
  show,
  hide,
  addEvent,
  safeParseInt,
  withLoading,
  removeEvent,
} from '../utils/domHelpers';
import { TILE_SIZE } from '../../shared/constants';
import { MapType, Tile, TileAction, TileEditMode } from '../../shared/types';
import type { ScriptParams } from '../../shared/scriptParams';
import {
  tileset,
  tilesetAlpha,
  isometricFrames,
  tileAnimations,
} from '../io/assets';
import { saveMap, type SaveMapResponse, fetchNpcs } from '../io/network';
import {
  foregroundCanvas,
  foregroundCtx,
  prepareWorldContext,
  worldScale,
} from './canvas';
import { useUIStore } from '../stores/uiStore';
import { getCamera, screenToWorld, worldToScreen } from './camera';
import { getMapOrientation } from '../core/gameState';
import {
  animatedTile,
  drawGroundTile,
  drawTiles,
  groundRect,
  visibleRange,
} from './mapRender';
import { isInputActive } from '../utils/domHelpers';

type ModeConfig = {
  place: (row: number, col: number) => void;
};

let gridCanvas: HTMLCanvasElement;
let gridCtx: CanvasRenderingContext2D;

let tilesetCanvas: HTMLCanvasElement;
let tilesetCtx: CanvasRenderingContext2D;

export let mapEditorInitialized = false;

let editorMusic = '';

const MAX_UNDO = 50;
let undoStack: Tile[][][] = [];
let redoStack: Tile[][][] = [];

/**
 * The map the editor's buffer belongs to, which may not be the one under
 * the player. A save takes the id from here, so a buffer only lands on the
 * map it was read from.
 */
let editorMapId = '';

export const setEditorMapId = (id: string) => {
  editorMapId = id;
};

/**
 * Set while a save is out and its map is read back. That load replaces the
 * buffer, so strokes meanwhile are refused.
 */
let saving = false;

export const setEditorSaving = (value: boolean) => {
  saving = value;
};

const snapshotForUndo = () => {
  undoStack.push(map.map((row) => row.map((tile) => ({ ...tile }))));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack = [];
};

export const getEditorTiles = (): Tile[][] => map;

export const undo = () => {
  if (saving || !undoStack.length) return;
  redoStack.push(map.map((row) => row.map((tile) => ({ ...tile }))));
  map = undoStack.pop()!;
  setMapEdited(true);
  renderMap();
};

export const redo = () => {
  if (saving || !redoStack.length) return;
  undoStack.push(map.map((row) => row.map((tile) => ({ ...tile }))));
  map = redoStack.pop()!;
  setMapEdited(true);
  renderMap();
};

export const initMapEditor = () => {
  tilesetCanvas = getEl<HTMLCanvasElement>('tilesetCanvas')!;
  if (!tilesetCanvas) {
    return;
  }
  gridCanvas = getEl<HTMLCanvasElement>('gridCanvas')!;
  gridCtx = gridCanvas.getContext('2d')!;
  tilesetCtx = tilesetCanvas.getContext('2d')!;
  paintPalette();
  startPaletteAnimations();
  setupEventListeners();
  initializeGrid();
  void loadEditorNpcNames();
  mapEditorInitialized = true;
};

/**
 * The atlas as the palette: a grid of TILE_SIZE cells, a tile's id being its
 * cell's index. A tiles.json frame shows scaled to fit its cell, and the
 * palette ends at the last id.
 */
const paintPalette = () => {
  if (activeKit()) return paintKitPalette();
  selectionShown = false;
  const perRow = Math.floor(tileset.width / TILE_SIZE);
  const frames = isometricFrames;
  const ids = Object.keys(frames).map(Number);
  // Frames are packed, cells are not: an atlas of many small frames has more
  // ids than its own height holds in cells.
  const height = ids.length
    ? Math.ceil((Math.max(...ids) + 1) / perRow) * TILE_SIZE
    : tileset.height;
  // Assigning a canvas size clears it and its state, so only on change.
  if (tilesetCanvas.width !== tileset.width)
    tilesetCanvas.width = tileset.width;
  if (tilesetCanvas.height !== height) tilesetCanvas.height = height;
  tilesetCtx.clearRect(0, 0, tilesetCanvas.width, tilesetCanvas.height);
  tilesetCtx.drawImage(
    tilesetAlpha,
    0,
    0,
    tileset.width,
    height,
    0,
    0,
    tileset.width,
    height,
  );
  for (const id of ids) drawPaletteCell(id, id);
  paintAnimatedCells();
};

const paletteCell = (id: number) => {
  const perRow = Math.floor(tileset.width / TILE_SIZE);
  return {
    x: (id % perRow) * TILE_SIZE,
    y: Math.floor(id / perRow) * TILE_SIZE,
  };
};

/** Tile `art`'s picture in tile `id`'s palette cell, a frame scaled to fit. */
const drawPaletteCell = (id: number, art: number) => {
  const { x, y } = paletteCell(id);
  const f = isometricFrames[art];
  const source = f ?? {
    ...paletteCell(art),
    width: TILE_SIZE,
    height: TILE_SIZE,
  };
  const k = Math.min(TILE_SIZE / source.width, TILE_SIZE / source.height);
  tilesetCtx.clearRect(x, y, TILE_SIZE, TILE_SIZE);
  tilesetCtx.drawImage(
    tilesetAlpha,
    source.x,
    source.y,
    source.width,
    source.height,
    x + (TILE_SIZE - source.width * k) / 2,
    y + TILE_SIZE - source.height * k,
    source.width * k,
    source.height * k,
  );
};

/**
 * Animated tiles show their current frame in the palette, and a cell that
 * is only a frame of another tile's animation is dimmed.
 */
const paintAnimatedCells = (now = performance.now()) => {
  const frameOnly = new Set<number>();
  for (const [key, { frames }] of Object.entries(tileAnimations)) {
    drawPaletteCell(Number(key), animatedTile(Number(key), now));
    for (const frame of frames)
      if (!tileAnimations[frame]) frameOnly.add(frame);
  }
  tilesetCtx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  for (const id of frameOnly) {
    const { x, y } = paletteCell(id);
    tilesetCtx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
  }
};

// The palette has a loop of its own, as SpritePreview does: the game's loop
// paints the world, not this panel.
let paletteFrame = 0;
let paletteStep = -1;
let selectionShown = false;
const runPaletteAnimations = () => {
  paletteFrame = requestAnimationFrame(runPaletteAnimations);
  if (activeKit()) return;
  const now = performance.now();
  let step = 0;
  for (const { ms } of Object.values(tileAnimations))
    step += Math.floor(now / ms);
  if (step === paletteStep) return;
  paletteStep = step;
  for (const key of Object.keys(tileAnimations))
    drawPaletteCell(Number(key), animatedTile(Number(key), now));
  // A repainted cell takes the edge of the selection with it.
  if (selectionShown) strokeSelection();
};

const startPaletteAnimations = () => {
  cancelAnimationFrame(paletteFrame);
  if (Object.keys(tileAnimations).length)
    paletteFrame = requestAnimationFrame(runPaletteAnimations);
};

type PieceCell = { col: number; row: number; id: number; blocks: boolean };
export type Piece = {
  name: string;
  group: string;
  layer: 'ground' | 'object' | 'decal';
  cols: number;
  rows: number;
  /** Each the cells one placement lays down. */
  variants: PieceCell[][];
  /** The frame for each set of joined neighbours (PieceSchema's `connect`). */
  joins?: Map<number, PieceCell>;
};
export type Kit = { pieces: Piece[]; pieceOf: Map<number, Piece> };

/** The pieces of a kit atlas, in the order of their first frame. */
export const readKit = (frames: typeof isometricFrames): Kit => {
  const byName = new Map<string, Piece>();
  const pieceOf = new Map<number, Piece>();
  for (const [key, frame] of Object.entries(frames)) {
    const p = frame.piece;
    if (!p) continue;
    let piece = byName.get(p.name);
    if (!piece) {
      piece = {
        name: p.name,
        group: p.group ?? '',
        layer: p.layer,
        cols: 1,
        rows: 1,
        variants: [],
      };
      byName.set(p.name, piece);
    }
    const cell = {
      col: p.at[0],
      row: p.at[1],
      id: Number(key),
      blocks: p.blocks,
    };
    if (p.connect !== undefined)
      (piece.joins ??= new Map()).set(p.connect, cell);
    else (piece.variants[p.variant] ??= []).push(cell);
    piece.cols = Math.max(piece.cols, cell.col + 1);
    piece.rows = Math.max(piece.rows, cell.row + 1);
    pieceOf.set(cell.id, piece);
  }
  const pieces = [...byName.values()];
  for (const piece of pieces) piece.variants = piece.variants.filter(Boolean);
  return { pieces, pieceOf };
};

// The cell each bit of `connect` names: above, right, below, left.
const JOINS = [
  [0, -1, 1],
  [1, 0, 2],
  [0, 1, 4],
  [-1, 0, 8],
] as const;
// Then the corners, each counted only where both its sides join, for 47
// sets. Water needs them to tell a pond's middle from the inside of a
// bend; a sides-only piece like a fence is looked up by its sides.
const CORNER_JOINS = [
  [1, -1, 16, 1 | 2],
  [1, 1, 32, 2 | 4],
  [-1, 1, 64, 4 | 8],
  [-1, -1, 128, 8 | 1],
] as const;

const rejoin = (tiles: Tile[][], kit: Kit, row: number, col: number) => {
  const tile = tiles[row]?.[col];
  const piece =
    tile?.maskIndex === undefined ? undefined : kit.pieceOf.get(tile.maskIndex);
  if (!tile || !piece?.joins) return;
  const same = (dc: number, dr: number) => {
    const next = tiles[row + dr]?.[col + dc]?.maskIndex;
    return next !== undefined && kit.pieceOf.get(next) === piece;
  };
  let mask = 0;
  for (const [dc, dr, bit] of JOINS) if (same(dc, dr)) mask |= bit;
  for (const [dc, dr, bit, sides] of CORNER_JOINS)
    if ((mask & sides) === sides && same(dc, dr)) mask |= bit;
  const cell = piece.joins.get(mask) ?? piece.joins.get(mask & 15);
  if (cell) tile.maskIndex = cell.id;
};

const randomIndex = (n: number) => Math.floor(Math.random() * n);

// The cells one placement of an object lays down: a joined piece starts
// alone and is rejoined to whatever is around it.
const pieceCells = (piece: Piece, pick: (n: number) => number) =>
  piece.joins
    ? [piece.joins.get(0) ?? piece.joins.values().next().value!]
    : (piece.variants[pick(piece.variants.length)] ?? []);

/**
 * Puts `piece` down with its first cell at (row, col), or with `null` takes
 * the object there away. An object decides whether its cells are walkable:
 * a grave put over a bone blocks, a bone put over a grave no longer does.
 */
export const placePiece = (
  tiles: Tile[][],
  kit: Kit,
  piece: Piece | null,
  row: number,
  col: number,
  pick = randomIndex,
) => {
  if (piece?.layer === 'ground') {
    const variant = piece.variants[pick(piece.variants.length)] ?? [];
    const cell = variant.find(
      (c) => c.col === col % piece.cols && c.row === row % piece.rows,
    );
    if (cell && tiles[row]?.[col]) tiles[row][col].tileIndex = cell.id;
    return;
  }
  const cells: { col: number; row: number; id?: number; blocks: boolean }[] =
    piece ? pieceCells(piece, pick) : [{ col: 0, row: 0, blocks: false }];
  for (const cell of cells) {
    const r = row + cell.row;
    const c = col + cell.col;
    const tile = tiles[r]?.[c];
    if (!tile) continue;
    tile.maskIndex = cell.id;
    tile.blocked = cell.blocks;
    rejoin(tiles, kit, r, c);
    for (const [dc, dr] of [...JOINS, ...CORNER_JOINS])
      rejoin(tiles, kit, r + dr, c + dc);
  }
};

let kitMemo: { frames: typeof isometricFrames; kit: Kit } | null = null;
const activeKit = (): Kit | null => {
  if (kitMemo?.frames !== isometricFrames)
    kitMemo = { frames: isometricFrames, kit: readKit(isometricFrames) };
  return kitMemo.kit.pieces.length ? kitMemo.kit : null;
};

let selectedPiece: Piece | 'erase' | null = null;

// The kit palette: an eraser, then each group under its name, a box a piece.
const PALETTE_WIDTH = 512;
const BOX = 128;
const HEADING = 22;
let paletteBoxes: { x: number; y: number; piece: Piece | 'erase' }[] = [];

const pieceAt = (x: number, y: number) =>
  paletteBoxes.find(
    (b) => x >= b.x && x < b.x + BOX && y >= b.y && y < b.y + BOX,
  )?.piece;

// What a box shows: the whole repeat of a ground, a short run of a fence,
// every cell of anything else.
const thumbnailCells = (piece: Piece): PieceCell[] => {
  if (!piece.joins) return piece.variants[0] ?? [];
  const any = piece.joins.values().next().value!;
  return [2, 10, 8].map((mask, col) => ({
    ...(piece.joins!.get(mask) ?? any),
    col,
    row: 0,
  }));
};

// A cell's centre as the map's projection draws it, from the piece's first.
const cellCenter = (col: number, row: number) =>
  getMapOrientation() === 'isometric'
    ? {
        x: (col - row) * (TILE_SIZE / 2),
        y: (col + row + 1) * (TILE_SIZE / 4),
      }
    : { x: (col + 0.5) * TILE_SIZE, y: (row + 0.5) * TILE_SIZE };

const drawThumbnail = (piece: Piece, x: number, y: number) => {
  const placed = thumbnailCells(piece).flatMap((cell) => {
    const f = isometricFrames[cell.id];
    if (!f) return [];
    const { x: cx, y: cy } = cellCenter(cell.col, cell.row);
    return [
      { f, x: cx - f.anchorX, y: cy - f.anchorY, depth: cell.col + cell.row },
    ];
  });
  if (!placed.length) return;
  const left = Math.min(...placed.map((p) => p.x));
  const top = Math.min(...placed.map((p) => p.y));
  const width = Math.max(...placed.map((p) => p.x + p.f.drawWidth)) - left;
  const height = Math.max(...placed.map((p) => p.y + p.f.drawHeight)) - top;
  const k = Math.min((BOX - 12) / width, (BOX - 12) / height, 2);
  const ox = x + (BOX - width * k) / 2 - left * k;
  const oy = y + (BOX - height * k) / 2 - top * k;
  for (const p of placed.sort((a, b) => a.depth - b.depth)) {
    tilesetCtx.drawImage(
      tilesetAlpha,
      p.f.x,
      p.f.y,
      p.f.width,
      p.f.height,
      ox + p.x * k,
      oy + p.y * k,
      p.f.drawWidth * k,
      p.f.drawHeight * k,
    );
  }
};

const paintKitPalette = () => {
  const kit = activeKit()!;
  const boxes: typeof paletteBoxes = [{ x: 0, y: 0, piece: 'erase' }];
  const headings: { y: number; text: string }[] = [];
  let x = BOX;
  let y = 0;
  let group: string | undefined;
  for (const piece of kit.pieces) {
    if (piece.group !== group) {
      group = piece.group;
      if (x > 0) y += BOX;
      x = 0;
      if (group) {
        headings.push({ y, text: group });
        y += HEADING;
      }
    }
    boxes.push({ x, y, piece });
    x += BOX;
    if (x >= PALETTE_WIDTH) {
      x = 0;
      y += BOX;
    }
  }
  paletteBoxes = boxes;
  const height = y + (x > 0 ? BOX : 0);
  if (tilesetCanvas.width !== PALETTE_WIDTH)
    tilesetCanvas.width = PALETTE_WIDTH;
  if (tilesetCanvas.height !== height) tilesetCanvas.height = height;
  tilesetCtx.clearRect(0, 0, PALETTE_WIDTH, height);
  tilesetCtx.imageSmoothingEnabled = false;
  tilesetCtx.font = 'bold 13px system-ui, sans-serif';
  tilesetCtx.textBaseline = 'middle';
  tilesetCtx.fillStyle = '#222';
  for (const h of headings) tilesetCtx.fillText(h.text, 8, h.y + HEADING / 2);
  for (const box of boxes) {
    if (box.piece === 'erase') {
      tilesetCtx.font = '48px system-ui, sans-serif';
      tilesetCtx.textAlign = 'center';
      tilesetCtx.fillText('✕', box.x + BOX / 2, box.y + BOX / 2);
      tilesetCtx.textAlign = 'start';
      tilesetCtx.font = 'bold 13px system-ui, sans-serif';
    } else {
      drawThumbnail(box.piece, box.x, box.y);
    }
    if (box.piece === selectedPiece) {
      tilesetCtx.strokeStyle = 'red';
      tilesetCtx.lineWidth = 3;
      tilesetCtx.strokeRect(box.x + 2, box.y + 2, BOX - 4, BOX - 4);
    }
  }
};

const selectedTile = { startX: 0, startY: 0, endX: 0, endY: 0 };
let isSelecting = false;
let isPlacing = false;
let activeMode: TileEditMode | null = null;
let mapWidth = 20;
let mapHeight = 14;
let originalMap: Tile[][] = [];
let map: Tile[][] = [];
let hoveredCell: { row: number; col: number } | null = null;
let hoverAt: { x: number; y: number } | null = null;

// NPC id -> name, so spawn tiles can show which NPC they place (not just "N").
let npcNameById: Record<string, string> = {};

// Load NPC names once so spawn markers are legible, then repaint the overlay.
export const loadEditorNpcNames = async () => {
  try {
    const npcs = await fetchNpcs();
    npcNameById = Object.fromEntries(npcs.map((n) => [String(n.id), n.name]));
  } catch {
    return; // names are a nicety; the "N" marker still shows without them
  }
  if (map.length) renderEditorLayer();
};

// The script trigger's settings, pushed here by the mode controls. Params
// are typed by their declaration, which only the React field knows, so
// they cannot be read back from the DOM like other modes.
let pendingScript: { scriptId: string; params: ScriptParams } = {
  scriptId: '',
  params: {},
};

export const setPendingScriptTrigger = (
  scriptId: string,
  params: ScriptParams,
): void => {
  pendingScript = { scriptId, params };
};

function toggleTrigger(
  tile: Tile,
  action: TileAction['action'],
  strParam?: string,
  numParam?: number,
  params?: ScriptParams,
) {
  // A new array: undo snapshots and the discard copy share the tile's arrays,
  // so an in-place removal would reach them too.
  const triggers = [...(tile.triggers ?? [])];
  const i = triggers.findIndex((t) => t.action === action);
  if (i >= 0) {
    triggers.splice(i, 1);
  } else {
    if (action === 'message') {
      triggers.push({ action, text: strParam ?? '' });
    } else if (action === 'sound') {
      triggers.push({ action, file: strParam ?? '' });
    } else if (action === 'changeSprite') {
      triggers.push({ action, spriteId: numParam ?? 0 });
    } else if (action === 'script') {
      triggers.push({
        action,
        scriptId: strParam ?? '',
        ...(params &&
          Object.keys(params).length > 0 && { scriptParams: { ...params } }),
      });
    } else {
      triggers.push({ action });
    }
  }
  tile.triggers = triggers.length ? triggers : undefined;
}

const handleHover = (event: MouseEvent) => {
  hoverAt = getMousePosition(event, foregroundCanvas);
  if (updateHoveredCell()) renderMap();
};

// Which tile the cursor is over depends on the camera as much as on the cursor:
// a step with the mouse parked slides a different tile under it.
const updateHoveredCell = (): boolean => {
  if (!hoverAt) return false;
  const p = screenToWorld(hoverAt.x, hoverAt.y);
  const col = Math.floor(p.x / TILE_SIZE);
  const row = Math.floor(p.y / TILE_SIZE);
  if (hoveredCell && hoveredCell.row === row && hoveredCell.col === col)
    return false;
  hoveredCell = { row, col };
  return true;
};

const modes: Record<TileEditMode, ModeConfig> = {
  blocking: {
    place: (row: number, col: number) => {
      map[row][col].blocked = !map[row][col].blocked;
      setMapEdited(true);
      renderMap();
    },
  },
  warping: {
    place: (row: number, col: number) => {
      const mapTo = getInputValue('warpMap');
      const xTo = safeParseInt(getInputValue('xTo'));
      const yTo = safeParseInt(getInputValue('yTo'));
      if (mapTo && !isNaN(xTo) && !isNaN(yTo)) {
        if (map[row][col].warp?.to) {
          map[row][col].warp = undefined;
        } else {
          map[row][col].warp = {
            to: mapTo,
            position: { x: xTo * TILE_SIZE, y: yTo * TILE_SIZE },
          };
        }
        setMapEdited(true);
        renderMap();
      }
    },
  },
  npc: {
    place: (row: number, col: number) => {
      const npc = getInputValue('npc');
      if (npc) {
        if (map[row][col].npcSpawn) {
          map[row][col].npcSpawn = undefined;
        } else {
          map[row][col].npcSpawn = npc;
        }
        setMapEdited(true);
        renderMap();
      }
    },
  },
  item: {
    place: (row: number, col: number) => {
      const item = getInputValue('item');
      if (item) {
        if (map[row][col].item) {
          map[row][col].item = undefined;
        } else {
          map[row][col].item = safeParseInt(item);
        }
        setMapEdited(true);
        renderMap();
      }
    },
  },
  shop: {
    place: (row: number, col: number) => {
      const shop = getInputValue('shop');
      if (shop) {
        if (map[row][col].shop) {
          map[row][col].shop = undefined;
        } else {
          map[row][col].shop = shop;
        }
        setMapEdited(true);
        renderMap();
      }
    },
  },
  bank: {
    place: (row: number, col: number) => {
      map[row][col].bank = !map[row][col].bank;
      setMapEdited(true);
      renderMap();
    },
  },
  avoidNpc: {
    place: (row: number, col: number) => {
      map[row][col].avoidNpc = !map[row][col].avoidNpc;
      setMapEdited(true);
      renderMap();
    },
  },
  fringe: {
    place: (row: number, col: number) =>
      toggleLayerTiles(row, col, 'fringeIndex'),
  },
  mask: {
    place: (row: number, col: number) =>
      toggleLayerTiles(row, col, 'maskIndex'),
  },
  heal: {
    place: (row: number, col: number) => {
      toggleTrigger(map[row][col], 'heal');
      setMapEdited(true);
      renderMap();
    },
  },
  kill: {
    place: (row: number, col: number) => {
      toggleTrigger(map[row][col], 'kill');
      setMapEdited(true);
      renderMap();
    },
  },
  warn: {
    place: (row: number, col: number) => {
      toggleTrigger(map[row][col], 'message', '⚠️ Entering a dangerous area!');
      setMapEdited(true);
      renderMap();
    },
  },
  door: {
    place: (row: number, col: number) => {
      const requiresItem = safeParseInt(getInputValue('doorItem'));
      const openTileIndex = safeParseInt(getInputValue('doorOpenTile'));
      if (isNaN(requiresItem) || isNaN(openTileIndex)) return;
      if (map[row][col].door) {
        map[row][col].door = undefined;
        map[row][col].blocked = false;
      } else {
        map[row][col].door = { requiresItem, openTileIndex };
        map[row][col].blocked = true;
      }
      setMapEdited(true);
      renderMap();
    },
  },
  sound: {
    place: (row: number, col: number) => {
      const file = getInputValue('soundFile');
      if (!file) return;
      toggleTrigger(map[row][col], 'sound', file);
      setMapEdited(true);
      renderMap();
    },
  },
  changeSprite: {
    place: (row: number, col: number) => {
      const spriteId = safeParseInt(getInputValue('changeSpriteId'));
      if (isNaN(spriteId)) return;
      toggleTrigger(map[row][col], 'changeSprite', undefined, spriteId);
      setMapEdited(true);
      renderMap();
    },
  },
  script: {
    place: (row: number, col: number) => {
      const { scriptId, params } = pendingScript;
      if (!scriptId) return;
      toggleTrigger(map[row][col], 'script', scriptId, undefined, params);
      setMapEdited(true);
      renderMap();
    },
  },
  conditionalBlock: {
    place: (row: number, col: number) => {
      const id = getInputValue('conditionalBlockId');
      if (!id) return;
      if (map[row][col].conditionalBlock === id) {
        map[row][col].conditionalBlock = undefined;
        map[row][col].blocked = false;
      } else {
        map[row][col].conditionalBlock = id;
        map[row][col].blocked = true;
      }
      setMapEdited(true);
      renderMap();
    },
  },
};

const toggleMode = (mode: TileEditMode) => {
  activeMode = activeMode === mode ? null : mode;
};

const getMousePosition = (event: MouseEvent, canvas: HTMLCanvasElement) => {
  const rect = canvas.getBoundingClientRect();
  const scale = canvas === foregroundCanvas ? worldScale : 1;
  const scaleX = canvas.width / scale / rect.width;
  const scaleY = canvas.height / scale / rect.height;

  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;

  return { x, y };
};

const startSelecting = (event: MouseEvent) => {
  event.stopPropagation();
  const { x, y } = getMousePosition(event, tilesetCanvas);
  if (activeKit()) {
    selectedPiece = pieceAt(x, y) ?? selectedPiece;
    paintKitPalette();
    return;
  }
  selectedTile.startX = Math.floor(x / TILE_SIZE);
  selectedTile.startY = Math.floor(y / TILE_SIZE);
  selectedTile.endX = selectedTile.startX;
  selectedTile.endY = selectedTile.startY;
  isSelecting = true;
};

const updateSelection = (event: MouseEvent) => {
  if (activeKit()) {
    const { x, y } = getMousePosition(event, tilesetCanvas);
    const piece = pieceAt(x, y);
    tilesetCanvas.title = piece === 'erase' ? 'Erase' : (piece?.name ?? '');
    return;
  }
  if (!isSelecting) return;
  const { x, y } = getMousePosition(event, tilesetCanvas);
  selectedTile.endX = Math.floor(x / TILE_SIZE);
  selectedTile.endY = Math.floor(y / TILE_SIZE);
  highlightSelectedTile();
};

const endSelecting = () => {
  isSelecting = false;
  highlightSelectedTile();
};

const highlightSelectedTile = () => {
  paintPalette();
  strokeSelection();
  selectionShown = true;
};

const strokeSelection = () => {
  tilesetCtx.strokeStyle = 'red';
  tilesetCtx.lineWidth = 2;
  const startX = Math.min(selectedTile.startX, selectedTile.endX) * TILE_SIZE;
  const startY = Math.min(selectedTile.startY, selectedTile.endY) * TILE_SIZE;
  const width =
    (Math.abs(selectedTile.startX - selectedTile.endX) + 1) * TILE_SIZE;
  const height =
    (Math.abs(selectedTile.startY - selectedTile.endY) + 1) * TILE_SIZE;
  tilesetCtx.strokeRect(startX, startY, width, height);
};

// Tiles the current stroke has placed on. A drag fires many mousemoves per
// tile, so a stroke acts on each tile once, as a click would.
const strokeTiles = new Set<string>();

const startPlacing = (event: MouseEvent) => {
  if (saving) return;
  isPlacing = true;
  strokeTiles.clear();
  snapshotForUndo();
  placeTile(event);
};
const placeTileWhileDragging = (event: MouseEvent) => {
  if (isPlacing && !saving) placeTile(event);
};
const stopPlacing = () => {
  isPlacing = false;
};
const placeTile = (event: MouseEvent) => {
  const { x, y } = getMousePosition(event, foregroundCanvas);
  const p = screenToWorld(x, y);
  const col = Math.floor(p.x / TILE_SIZE);
  const row = Math.floor(p.y / TILE_SIZE);
  if (!map[row]?.[col]) return;
  const key = `${row},${col}`;
  if (strokeTiles.has(key)) return;
  strokeTiles.add(key);
  if (activeMode) {
    modes[activeMode].place(row, col);
  } else {
    placeSelectedTile(row, col);
  }
};

// Each tile of the tileset selection with the map cell it lands on when the
// selection's top-left corner goes at (row, col); cells past the map edge are
// skipped.
const forEachSelectedTile = (
  row: number,
  col: number,
  fn: (row: number, col: number, tileIndex: number) => void,
) => {
  if (activeKit()) {
    if (!selectedPiece || selectedPiece === 'erase') return;
    for (const cell of pieceCells(selectedPiece, () => 0))
      if (map[row + cell.row]?.[col + cell.col])
        fn(row + cell.row, col + cell.col, cell.id);
    return;
  }
  const { startX, startY, width, height } = calculateSelectionBounds();
  const tilesPerRow = Math.floor(tilesetCanvas.width / TILE_SIZE);
  for (let i = 0; i < width; i++) {
    for (let j = 0; j < height; j++) {
      if (
        row + j >= 0 &&
        col + i >= 0 &&
        row + j < mapHeight &&
        col + i < mapWidth
      ) {
        fn(row + j, col + i, (startY + j) * tilesPerRow + (startX + i));
      }
    }
  }
};

const placeSelectedTile = (row: number, col: number) => {
  const kit = activeKit();
  if (kit) {
    if (!selectedPiece) return;
    placePiece(
      map,
      kit,
      selectedPiece === 'erase' ? null : selectedPiece,
      row,
      col,
    );
    setMapEdited(true);
    renderMap();
    return;
  }
  forEachSelectedTile(row, col, (r, c, tileIndex) => {
    map[r][c] = { ...map[r][c], tileIndex };
    drawTileOnCanvas(c, r, tileIndex);
  });
  setMapEdited(true);
  if (getMapOrientation() === 'isometric') renderMap();
};

const toggleLayerTiles = (
  row: number,
  col: number,
  layer: 'fringeIndex' | 'maskIndex',
) => {
  forEachSelectedTile(row, col, (r, c, tileIndex) => {
    map[r][c][layer] = map[r][c][layer] === tileIndex ? undefined : tileIndex;
  });
  setMapEdited(true);
  renderMap();
};

const calculateSelectionBounds = () => {
  const startX = Math.min(selectedTile.startX, selectedTile.endX);
  const startY = Math.min(selectedTile.startY, selectedTile.endY);
  const width = Math.abs(selectedTile.startX - selectedTile.endX) + 1;
  const height = Math.abs(selectedTile.startY - selectedTile.endY) + 1;
  return { startX, startY, width, height };
};

const drawTileOnCanvas = (
  col: number,
  row: number,
  tileIndex: number,
  clear = true,
) => {
  const cam = getCamera();
  const r = groundRect(col, row, tileIndex);
  if (
    r.x - cam.x >= foregroundCanvas.width / worldScale ||
    r.x + r.width - cam.x <= 0 ||
    r.y - cam.y >= foregroundCanvas.height / worldScale ||
    r.y + r.height - cam.y <= 0
  )
    return;
  foregroundCtx.save();
  foregroundCtx.translate(-cam.x, -cam.y);
  drawGroundTile(foregroundCtx, col, row, tileIndex, clear);
  foregroundCtx.restore();
};

export const fillMap = () => {
  if (saving || !tilesetCanvas) return;
  const kit = activeKit();
  if (kit) {
    const piece = selectedPiece;
    if (piece === 'erase' || piece?.layer !== 'ground') return;
    snapshotForUndo();
    map.forEach((tiles, row) =>
      tiles.forEach((_, col) => placePiece(map, kit, piece, row, col)),
    );
    setMapEdited(true);
    renderMap();
    return;
  }
  snapshotForUndo();
  const { startX, startY } = calculateSelectionBounds();
  const tilesPerRow = Math.floor(tilesetCanvas.width / TILE_SIZE);
  const tileIndex = startY * tilesPerRow + startX;
  for (let row = 0; row < mapHeight; row++) {
    for (let col = 0; col < mapWidth; col++) {
      map[row][col] = { ...map[row][col], tileIndex };
    }
  }
  setMapEdited(true);
  renderMap();
};

export const toggleBlocking = () => toggleMode('blocking');
export const toggleWarping = () => toggleMode('warping');
export const toggleNpc = () => toggleMode('npc');
export const toggleItem = () => toggleMode('item');
export const toggleShop = () => toggleMode('shop');
export const toggleBank = () => toggleMode('bank');
export const toggleAvoidNpc = () => toggleMode('avoidNpc');
export const toggleFringe = () => toggleMode('fringe');
export const toggleMask = () => toggleMode('mask');
export const toggleHeal = () => toggleMode('heal');
export const toggleKill = () => toggleMode('kill');
export const toggleWarn = () => toggleMode('warn');
export const toggleDoor = () => toggleMode('door');
export const toggleSound = () => toggleMode('sound');
export const toggleChangeSprite = () => toggleMode('changeSprite');
export const toggleScript = () => toggleMode('script');
export const toggleConditionalBlock = () => toggleMode('conditionalBlock');

const handleKeyDown = (e: KeyboardEvent) => {
  // Ctrl+Z in a text field undoes the typing, not the map.
  if (isInputActive()) return;
  if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    undo();
  }
  if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
    e.preventDefault();
    redo();
  }
};

const setupEventListeners = () => {
  addEvent('tilesetCanvas', 'mousedown', startSelecting);
  addEvent('tilesetCanvas', 'mousemove', updateSelection);
  addEvent('tilesetCanvas', 'mouseup', endSelecting);
  addEvent('foregroundCanvas', 'mousedown', startPlacing);
  addEvent('foregroundCanvas', 'mousemove', placeTileWhileDragging);
  addEvent('foregroundCanvas', 'mousemove', handleHover);
  addEvent('foregroundCanvas', 'mouseup', stopPlacing);
  document.addEventListener('keydown', handleKeyDown);
};

const removeEventListeners = () => {
  removeEvent('tilesetCanvas', 'mousedown', startSelecting);
  removeEvent('tilesetCanvas', 'mousemove', updateSelection);
  removeEvent('tilesetCanvas', 'mouseup', endSelecting);
  removeEvent('foregroundCanvas', 'mousedown', startPlacing);
  removeEvent('foregroundCanvas', 'mousemove', placeTileWhileDragging);
  removeEvent('foregroundCanvas', 'mousemove', handleHover);
  removeEvent('foregroundCanvas', 'mouseup', stopPlacing);
  document.removeEventListener('keydown', handleKeyDown);
};

// Paints what the editor holds. Only `setEditorTiles` seeds that copy and
// takes the original a discard restores.
const renderMap = () => {
  drawTiles(map);
  renderEditorLayer();
};

/**
 * Repaints the editor's layer: grid, markers, hover cell. It is drawn in
 * camera space, so the game loop calls this whenever it redraws the ground.
 */
export const renderEditorLayer = () => {
  if (!mapEditorInitialized) return;
  updateHoveredCell();
  clearAndDrawGrid();
  drawMarkers(map);
  drawHoverCell();
};

// A cell's outline as a subpath: a square on a flat map, a diamond on an
// isometric one. The caller begins the path, so a whole grid strokes at once.
const traceCell = (col: number, row: number) => {
  for (const [dx, dy] of [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ]) {
    const p = worldToScreen((col + dx) * TILE_SIZE, (row + dy) * TILE_SIZE);
    if (!dx && !dy) gridCtx.moveTo(p.x, p.y);
    else gridCtx.lineTo(p.x, p.y);
  }
  gridCtx.closePath();
};

const drawHoverCell = () => {
  if (!hoveredCell || !gridCtx) return;
  const { row, col } = hoveredCell;
  if (!map[row]?.[col]) return;
  gridCtx.beginPath();
  traceCell(col, row);
  gridCtx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  gridCtx.fill();
  const p = worldToScreen((col + 0.5) * TILE_SIZE, (row + 0.5) * TILE_SIZE);
  gridCtx.fillStyle = 'black';
  gridCtx.font = '12px Arial';
  gridCtx.fillText(`(${col}, ${row})`, p.x - 20, p.y);
};

const drawGrid = () => {
  const range = visibleRange(
    map,
    gridCanvas.width / worldScale,
    gridCanvas.height / worldScale,
    TILE_SIZE,
  );
  gridCtx.strokeStyle = '#ddd';
  gridCtx.lineWidth = 1;
  gridCtx.beginPath();
  for (let row = range.startRow; row <= range.endRow; row++) {
    for (let col = range.startCol; col <= range.endCol; col++) {
      traceCell(col, row);
    }
  }
  gridCtx.stroke();
};

export const setMapEdited = (edited: boolean) => {
  useUIStore.getState().setMapEdited(edited);
};

const initializeGrid = () => {
  if (!gridCtx || !gridCanvas) return;
  gridCanvas.width = foregroundCanvas.width;
  gridCanvas.height = foregroundCanvas.height;
  prepareWorldContext(gridCtx);
  drawGrid();
};
const clearAndDrawGrid = () => {
  if (!gridCtx || !gridCanvas) return;
  gridCtx.clearRect(
    0,
    0,
    gridCanvas.width / worldScale,
    gridCanvas.height / worldScale,
  );
  drawGrid();
};

const drawMarkers = (tiles: Tile[][]) => {
  if (!gridCtx) return;
  const { startCol, endCol, startRow, endRow } = visibleRange(
    tiles,
    gridCanvas.width / worldScale,
    gridCanvas.height / worldScale,
    TILE_SIZE,
  );
  for (let rowIndex = startRow; rowIndex <= endRow; rowIndex++) {
    const row = tiles[rowIndex];
    if (!row) continue;
    for (let colIndex = startCol; colIndex <= endCol; colIndex++) {
      const tile = row[colIndex];
      if (!tile) continue;
      const marks: [string, string][] = [];
      if (tile.blocked) marks.push(['B', '#ff3b30']);
      if (tile.warp) marks.push(['W', '#4d8dff']);
      if (tile.npcSpawn) marks.push(['N', 'yellow']);
      if (tile.item) marks.push(['I', 'orange']);
      if (tile.shop) marks.push(['S', '#22c55e']);
      if (tile.bank) marks.push(['$', '#f59e0b']);
      if (tile.avoidNpc) marks.push(['A', '#c084fc']);
      if (tile.triggers?.some((t) => t.action === 'heal'))
        marks.push(['H', '#00e676']);
      if (tile.triggers?.some((t) => t.action === 'kill'))
        marks.push(['K', '#ff1744']);
      if (tile.triggers?.some((t) => t.action === 'message'))
        marks.push(['!', '#ff9100']);
      if (tile.triggers?.some((t) => t.action === 'sound'))
        marks.push(['♪', '#00bcd4']);
      if (tile.triggers?.some((t) => t.action === 'changeSprite'))
        marks.push(['C', '#c084fc']);
      if (tile.triggers?.some((t) => t.action === 'script'))
        marks.push(['J', '#90a4ae']);
      if (tile.door) marks.push(['D', '#ff8f00']);
      if (tile.conditionalBlock) marks.push(['?', '#90a4ae']);
      if (marks.length) drawMarks(colIndex, rowIndex, marks);
      if (tile.npcSpawn) drawNpcSpawnName(colIndex, rowIndex, tile.npcSpawn);
      if (tile.maskIndex !== undefined)
        drawLayerCorner(colIndex, rowIndex, '#00bcd4', 'left');
      if (tile.fringeIndex !== undefined)
        drawLayerCorner(colIndex, rowIndex, '#9c27b0', 'right');
    }
  }
};

const tileOnScreen = (col: number, row: number) => {
  const center = worldToScreen(
    (col + 0.5) * TILE_SIZE,
    (row + 0.5) * TILE_SIZE,
  );
  const height =
    getMapOrientation() === 'isometric' ? TILE_SIZE / 2 : TILE_SIZE;
  const sx = center.x - TILE_SIZE / 2;
  const sy = center.y - height / 2;
  const on =
    sx + TILE_SIZE > 0 &&
    sx < gridCanvas.width / worldScale &&
    sy + TILE_SIZE > 0 &&
    sy < gridCanvas.height / worldScale;
  return on ? { sx, sy, height } : null;
};

// Small letters side by side in the tile's top-left corner: the tile under
// them is what the creator is painting, and it has to stay in view.
const drawMarks = (col: number, row: number, marks: [string, string][]) => {
  const at = tileOnScreen(col, row);
  if (!gridCtx || !at) return;
  gridCtx.font = 'bold 13px Arial';
  gridCtx.textBaseline = 'top';
  gridCtx.lineWidth = 3;
  gridCtx.lineJoin = 'round';
  gridCtx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
  marks.forEach(([letter, color], i) => {
    const x = at.sx + 3 + i * 11;
    gridCtx.strokeText(letter, x, at.sy + 3);
    gridCtx.fillStyle = color;
    gridCtx.fillText(letter, x, at.sy + 3);
  });
  gridCtx.textBaseline = 'alphabetic';
  gridCtx.lineWidth = 1;
  gridCtx.lineJoin = 'miter';
};

// A corner in the layer's colour, the same the layer's button lights up in:
// which layers a tile has, without covering what they draw.
const LAYER_CORNER = 10;
const drawLayerCorner = (
  col: number,
  row: number,
  color: string,
  side: 'left' | 'right',
) => {
  const at = tileOnScreen(col, row);
  if (!gridCtx || !at) return;
  const x = side === 'left' ? at.sx : at.sx + TILE_SIZE;
  const inward = side === 'left' ? LAYER_CORNER : -LAYER_CORNER;
  const y = at.sy + at.height;
  gridCtx.globalAlpha = 0.7;
  gridCtx.fillStyle = color;
  gridCtx.beginPath();
  gridCtx.moveTo(x, y);
  gridCtx.lineTo(x + inward, y);
  gridCtx.lineTo(x, y - LAYER_CORNER);
  gridCtx.closePath();
  gridCtx.fill();
  gridCtx.globalAlpha = 1;
};

// The NPC's name (or "#id" if not loaded yet) at the bottom of a spawn tile, so
// you can tell which NPC the "N" marker places.
const drawNpcSpawnName = (col: number, row: number, npcId: string) => {
  if (!gridCtx) return;
  const at = tileOnScreen(col, row);
  if (!at) return;
  const { sx, sy, height } = at;
  const label = npcNameById[npcId] ?? `#${npcId}`;
  gridCtx.font = 'bold 12px Arial';
  gridCtx.textAlign = 'center';
  gridCtx.lineWidth = 3;
  // Round, like the names in the world: mitred joins spike off an M or a W.
  gridCtx.lineJoin = 'round';
  gridCtx.strokeStyle = 'black';
  gridCtx.fillStyle = 'yellow';
  gridCtx.strokeText(label, sx + TILE_SIZE / 2, sy + height - 6);
  gridCtx.fillText(label, sx + TILE_SIZE / 2, sy + height - 6);
  gridCtx.textAlign = 'left';
  gridCtx.lineWidth = 1;
  gridCtx.lineJoin = 'miter';
};

export const setEditorMusic = (music: string): void => {
  editorMusic = music;
};

export const saveCurrentMap = async (
  name: string,
  type: MapType,
): Promise<SaveMapResponse | null> => {
  let result: SaveMapResponse | null = null;
  await withLoading('saveButton', async () => {
    result = await saveMap(
      map,
      name,
      type,
      editorMusic || undefined,
      editorMapId || undefined,
    );
    if (result?.success) {
      setMapEdited(false);
      originalMap = map.map((row) => row.map((tile) => ({ ...tile })));
    }
  });
  return result;
};

export const resetToOriginalMap = () => {
  map = originalMap.map((row) => row.map((t) => ({ ...t })));
};

export const toggleMapEditor = (shouldShow: boolean) => {
  if (shouldShow) {
    if (!mapEditorInitialized) {
      initMapEditor();
    } else {
      paintPalette();
      startPaletteAnimations();
      setupEventListeners();
      initializeGrid();
    }
    show('gridCanvas', 'block');
  } else {
    cancelAnimationFrame(paletteFrame);
    removeEventListeners();
    hide('gridCanvas');
    setMapEdited(false);
    activeMode = null;
    mapEditorInitialized = false;
    undoStack = [];
    redoStack = [];
  }

  renderMap();
};

/**
 * Loads the map the editor edits. These are the server's tiles from the
 * admin route, since the game's copy is stripped of triggers, warps and
 * doors (see `TilePublic`).
 */
export const setEditorTiles = (tiles: Tile[][], music?: string) => {
  updateEditorMap(tiles, music);
  renderEditorLayer();
};

const updateEditorMap = (tiles: Tile[][], music?: string) => {
  // The history belongs to the buffer, so a load clears it; an undo must not
  // bring back another map's tiles.
  undoStack = [];
  redoStack = [];
  map = tiles.map((row) => row.map((tile) => ({ ...tile })));
  originalMap = tiles.map((row) => row.map((tile) => ({ ...tile })));
  mapWidth = tiles[0]?.length ?? 20;
  mapHeight = tiles.length;
  editorMusic = music ?? '';
};
