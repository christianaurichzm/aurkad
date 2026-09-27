import {
  getEl,
  getInputValue,
  show,
  hide,
  addEvent,
  safeParseInt,
  withLoading,
  removeEvent,
} from '../../utils/domHelpers';
import { TILE_SIZE } from '../../../shared/constants';
import {
  MapType,
  Tile,
  TileAction,
  TileEditMode,
  TilePublic,
} from '../../../shared/types';
import type { ScriptParams } from '../../../shared/scriptParams';
import { tileset, tilesetAlpha } from '../../io/assets';
import { saveMap, type SaveMapResponse, fetchNpcs } from '../../io/network';
import { foregroundCanvas, foregroundCtx, maskCtx, fringeCtx } from '../canvas';
import { useUIStore } from '../../stores/uiStore';
import { getCamera } from '../camera';
import { isInputActive } from '../../utils/domHelpers';

type ModeConfig = {
  place: (row: number, col: number) => void;
};

let gridCanvas: HTMLCanvasElement;
let gridCtx: CanvasRenderingContext2D;

let tilesetCanvas: HTMLCanvasElement;
let tilesetCtx: CanvasRenderingContext2D;

export let tilesetEditorInitialized = false;

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

const snapshotForUndo = () => {
  undoStack.push(map.map((row) => row.map((tile) => ({ ...tile }))));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack = [];
};

export const getEditorTiles = (): Tile[][] => map;

export const undo = () => {
  if (!undoStack.length) return;
  redoStack.push(map.map((row) => row.map((tile) => ({ ...tile }))));
  map = undoStack.pop()!;
  setMapEdited(true);
  renderMap();
};

export const redo = () => {
  if (!redoStack.length) return;
  undoStack.push(map.map((row) => row.map((tile) => ({ ...tile }))));
  map = redoStack.pop()!;
  setMapEdited(true);
  renderMap();
};

export const initTilesetEditor = () => {
  tilesetCanvas = getEl<HTMLCanvasElement>('tilesetCanvas')!;
  if (!tilesetCanvas) {
    return;
  }
  gridCanvas = getEl<HTMLCanvasElement>('gridCanvas')!;
  gridCtx = gridCanvas.getContext('2d')!;
  tilesetCanvas.width = tileset.width;
  tilesetCanvas.height = tileset.height;
  tilesetCtx = tilesetCanvas.getContext('2d')!;
  tilesetCtx.drawImage(tilesetAlpha, 0, 0);
  setupEventListeners();
  initializeGrid();
  void loadEditorNpcNames();
  tilesetEditorInitialized = true;
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
  const triggers = tile.triggers ?? [];
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
  const cam = getCamera();
  const col = Math.floor((hoverAt.x + cam.x) / TILE_SIZE);
  const row = Math.floor((hoverAt.y + cam.y) / TILE_SIZE);
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

  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;

  return { x, y };
};

const startSelecting = (event: MouseEvent) => {
  event.stopPropagation();
  const { x, y } = getMousePosition(event, tilesetCanvas);
  selectedTile.startX = Math.floor(x / TILE_SIZE);
  selectedTile.startY = Math.floor(y / TILE_SIZE);
  selectedTile.endX = selectedTile.startX;
  selectedTile.endY = selectedTile.startY;
  isSelecting = true;
};

const updateSelection = (event: MouseEvent) => {
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
  tilesetCtx.clearRect(0, 0, tilesetCanvas.width, tilesetCanvas.height);
  tilesetCtx.drawImage(tilesetAlpha, 0, 0);
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
  isPlacing = true;
  strokeTiles.clear();
  snapshotForUndo();
  placeTile(event);
};
const placeTileWhileDragging = (event: MouseEvent) => {
  if (isPlacing) placeTile(event);
};
const stopPlacing = () => {
  isPlacing = false;
};
const placeTile = (event: MouseEvent) => {
  const { x, y } = getMousePosition(event, foregroundCanvas);
  const cam = getCamera();
  const col = Math.floor((x + cam.x) / TILE_SIZE);
  const row = Math.floor((y + cam.y) / TILE_SIZE);
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
  const { startX, startY, width, height } = calculateSelectionBounds();
  const tilesPerRow = Math.floor(tilesetCanvas.width / TILE_SIZE);
  for (let i = 0; i < width; i++) {
    for (let j = 0; j < height; j++) {
      if (row + j < mapHeight && col + i < mapWidth) {
        fn(row + j, col + i, (startY + j) * tilesPerRow + (startX + i));
      }
    }
  }
};

const placeSelectedTile = (row: number, col: number) => {
  forEachSelectedTile(row, col, (r, c, tileIndex) => {
    map[r][c] = { ...map[r][c], tileIndex };
    drawTileOnCanvas(c, r, tileIndex);
  });
  setMapEdited(true);
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
  const sx = col * TILE_SIZE - cam.x;
  const sy = row * TILE_SIZE - cam.y;
  if (
    sx + TILE_SIZE <= 0 ||
    sx >= foregroundCanvas.width ||
    sy + TILE_SIZE <= 0 ||
    sy >= foregroundCanvas.height
  )
    return;
  const tilesPerRow = tileset.width / TILE_SIZE;
  const tileX = (tileIndex % tilesPerRow) * TILE_SIZE;
  const tileY = Math.floor(tileIndex / tilesPerRow) * TILE_SIZE;
  // One tile placed by hand lands on top of the tile that was there, so its
  // pixels have to go first. A full pass has already cleared the canvas.
  if (clear) foregroundCtx.clearRect(sx, sy, TILE_SIZE, TILE_SIZE);
  foregroundCtx.drawImage(
    tileset,
    tileX,
    tileY,
    TILE_SIZE,
    TILE_SIZE,
    sx,
    sy,
    TILE_SIZE,
    TILE_SIZE,
  );
};

export const fillMap = () => {
  if (!tilesetCanvas) return;
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

// The rows and columns the camera can see, so a pass costs the viewport
// rather than the whole map.
const visibleRange = <T>(tiles: T[][], width: number, height: number) => {
  const cam = getCamera();
  return {
    startCol: Math.max(0, Math.floor(cam.x / TILE_SIZE)),
    endCol: Math.min(
      (tiles[0]?.length ?? 0) - 1,
      Math.ceil((cam.x + width) / TILE_SIZE),
    ),
    startRow: Math.max(0, Math.floor(cam.y / TILE_SIZE)),
    endRow: Math.min(tiles.length - 1, Math.ceil((cam.y + height) / TILE_SIZE)),
  };
};

const drawTiles = (tiles: TilePublic[][]) => {
  // The editor's copy is empty until fetched, and the loop repaints only on
  // camera or map change, so clearing here would leave the world blank.
  if (!tiles.length) return;
  foregroundCtx.clearRect(
    0,
    0,
    foregroundCanvas.width,
    foregroundCanvas.height,
  );
  const { startCol, endCol, startRow, endRow } = visibleRange(
    tiles,
    foregroundCanvas.width,
    foregroundCanvas.height,
  );
  for (let rowIndex = startRow; rowIndex <= endRow; rowIndex++) {
    const row = tiles[rowIndex];
    if (!row) continue;
    for (let colIndex = startCol; colIndex <= endCol; colIndex++) {
      const tile = row[colIndex];
      if (tile && tile.tileIndex !== -1) {
        drawTileOnCanvas(colIndex, rowIndex, tile.tileIndex, false);
      }
    }
  }
};

/**
 * The map as the game draws it: the tiles, and nothing the editor needs.
 * It runs on every frame the camera crosses a whole pixel, so it must not
 * copy the map, which renderMap below does and why the editor cannot call
 * that per frame.
 */
export const renderGameMap = (tiles: TilePublic[][]) => {
  drawTiles(tiles);
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
  if (!tilesetEditorInitialized) return;
  updateHoveredCell();
  clearAndDrawGrid();
  drawMarkers(map);
  drawHoverCell();
};

const drawHoverCell = () => {
  if (!hoveredCell || !gridCtx) return;
  const cam = getCamera();
  const { row, col } = hoveredCell;
  const sx = col * TILE_SIZE - cam.x;
  const sy = row * TILE_SIZE - cam.y;
  gridCtx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  gridCtx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
  gridCtx.fillStyle = 'black';
  gridCtx.font = '12px Arial';
  gridCtx.fillText(`(${col}, ${row})`, sx + 4, sy + 24);
};

const drawGrid = () => {
  const cam = getCamera();
  const width = gridCanvas.width;
  const height = gridCanvas.height;
  gridCtx.strokeStyle = '#ddd';
  gridCtx.lineWidth = 1;
  const startX = -(cam.x % TILE_SIZE);
  const startY = -(cam.y % TILE_SIZE);
  for (let x = startX; x <= width; x += TILE_SIZE) {
    gridCtx.beginPath();
    gridCtx.moveTo(x, 0);
    gridCtx.lineTo(x, height);
    gridCtx.stroke();
  }
  for (let y = startY; y <= height; y += TILE_SIZE) {
    gridCtx.beginPath();
    gridCtx.moveTo(0, y);
    gridCtx.lineTo(width, y);
    gridCtx.stroke();
  }
};

export const setMapEdited = (edited: boolean) => {
  useUIStore.getState().setMapEdited(edited);
};

const initializeGrid = () => {
  if (!gridCtx || !gridCanvas) return;
  gridCanvas.width = foregroundCanvas.width;
  gridCanvas.height = foregroundCanvas.height;
  drawGrid();
};
const clearAndDrawGrid = () => {
  if (!gridCtx || !gridCanvas) return;
  gridCtx.clearRect(0, 0, gridCanvas.width, gridCanvas.height);
  drawGrid();
};

const drawMarkers = (tiles: Tile[][]) => {
  if (!gridCtx) return;
  const { startCol, endCol, startRow, endRow } = visibleRange(
    tiles,
    gridCanvas.width,
    gridCanvas.height,
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
  const cam = getCamera();
  const sx = col * TILE_SIZE - cam.x;
  const sy = row * TILE_SIZE - cam.y;
  const on =
    sx + TILE_SIZE > 0 &&
    sx < gridCanvas.width &&
    sy + TILE_SIZE > 0 &&
    sy < gridCanvas.height;
  return on ? { sx, sy } : null;
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
  const y = at.sy + TILE_SIZE;
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
  const cam = getCamera();
  const sx = col * TILE_SIZE - cam.x;
  const sy = row * TILE_SIZE - cam.y;
  if (
    sx + TILE_SIZE <= 0 ||
    sx >= gridCanvas.width ||
    sy + TILE_SIZE <= 0 ||
    sy >= gridCanvas.height
  )
    return;
  const label = npcNameById[npcId] ?? `#${npcId}`;
  gridCtx.font = 'bold 12px Arial';
  gridCtx.textAlign = 'center';
  gridCtx.lineWidth = 3;
  // Round, like the names in the world: mitred joins spike off an M or a W.
  gridCtx.lineJoin = 'round';
  gridCtx.strokeStyle = 'black';
  gridCtx.fillStyle = 'yellow';
  gridCtx.strokeText(label, sx + TILE_SIZE / 2, sy + TILE_SIZE - 6);
  gridCtx.fillText(label, sx + TILE_SIZE / 2, sy + TILE_SIZE - 6);
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

export const toggleTilesetEditor = (shouldShow: boolean) => {
  if (shouldShow) {
    if (!tilesetEditorInitialized) {
      initTilesetEditor();
    } else {
      tilesetCtx.clearRect(0, 0, tileset.width, tileset.height);
      tilesetCtx.drawImage(tilesetAlpha, 0, 0);
      setupEventListeners();
      initializeGrid();
    }
    show('gridCanvas', 'block');
  } else {
    removeEventListeners();
    hide('gridCanvas');
    setMapEdited(false);
    activeMode = null;
    tilesetEditorInitialized = false;
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
  map = tiles.map((row) => row.map((tile) => ({ ...tile })));
  originalMap = tiles.map((row) => row.map((tile) => ({ ...tile })));
  mapWidth = tiles[0]?.length ?? 20;
  mapHeight = tiles.length;
  editorMusic = music ?? '';
};

export const renderMapMask = (
  tiles: TilePublic[][],
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D = maskCtx,
) => {
  if (!ctx || !tiles) return;
  const tilesPerRow = tileset.width / TILE_SIZE;
  const cam = getCamera();
  const startCol = Math.max(0, Math.floor(cam.x / TILE_SIZE));
  const endCol = Math.min(
    (tiles[0]?.length ?? 0) - 1,
    Math.ceil((cam.x + ctx.canvas.width) / TILE_SIZE),
  );
  const startRow = Math.max(0, Math.floor(cam.y / TILE_SIZE));
  const endRow = Math.min(
    tiles.length - 1,
    Math.ceil((cam.y + ctx.canvas.height) / TILE_SIZE),
  );
  for (let rowIndex = startRow; rowIndex <= endRow; rowIndex++) {
    const row = tiles[rowIndex];
    if (!row) continue;
    for (let colIndex = startCol; colIndex <= endCol; colIndex++) {
      const tile = row[colIndex];
      if (tile?.maskIndex !== undefined) {
        const tileX = (tile.maskIndex % tilesPerRow) * TILE_SIZE;
        const tileY = Math.floor(tile.maskIndex / tilesPerRow) * TILE_SIZE;
        ctx.drawImage(
          tilesetAlpha,
          tileX,
          tileY,
          TILE_SIZE,
          TILE_SIZE,
          colIndex * TILE_SIZE,
          rowIndex * TILE_SIZE,
          TILE_SIZE,
          TILE_SIZE,
        );
      }
    }
  }
};

export const renderMapFringe = (
  tiles: TilePublic[][],
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D = fringeCtx,
) => {
  if (!ctx || !tiles) return;
  const tilesPerRow = tileset.width / TILE_SIZE;
  const cam = getCamera();
  const startCol = Math.max(0, Math.floor(cam.x / TILE_SIZE));
  const endCol = Math.min(
    (tiles[0]?.length ?? 0) - 1,
    Math.ceil((cam.x + ctx.canvas.width) / TILE_SIZE),
  );
  const startRow = Math.max(0, Math.floor(cam.y / TILE_SIZE));
  const endRow = Math.min(
    tiles.length - 1,
    Math.ceil((cam.y + ctx.canvas.height) / TILE_SIZE),
  );
  for (let rowIndex = startRow; rowIndex <= endRow; rowIndex++) {
    const row = tiles[rowIndex];
    if (!row) continue;
    for (let colIndex = startCol; colIndex <= endCol; colIndex++) {
      const tile = row[colIndex];
      if (tile?.fringeIndex !== undefined) {
        const tileX = (tile.fringeIndex % tilesPerRow) * TILE_SIZE;
        const tileY = Math.floor(tile.fringeIndex / tilesPerRow) * TILE_SIZE;
        ctx.drawImage(
          tilesetAlpha,
          tileX,
          tileY,
          TILE_SIZE,
          TILE_SIZE,
          colIndex * TILE_SIZE,
          rowIndex * TILE_SIZE,
          TILE_SIZE,
          TILE_SIZE,
        );
      }
    }
  }
};
