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
import { MapType, Tile, TileAction, TileEditMode } from '../../../shared/types';
import { tileset, tilesetAlpha } from '../../io/assets';
import { saveMap, type SaveMapResponse, fetchNpcs } from '../../io/network';
import { foregroundCanvas, foregroundCtx, maskCtx, fringeCtx } from '../canvas';
import { useUIStore } from '../../stores/uiStore';
import { getCamera } from '../camera';

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

const snapshotForUndo = () => {
  undoStack.push(map.map((row) => row.map((tile) => ({ ...tile }))));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack = [];
};

export const undo = () => {
  if (!undoStack.length) return;
  redoStack.push(map.map((row) => row.map((tile) => ({ ...tile }))));
  map = undoStack.pop()!;
  setMapEdited(true);
  renderMap(map);
};

export const redo = () => {
  if (!redoStack.length) return;
  undoStack.push(map.map((row) => row.map((tile) => ({ ...tile }))));
  map = redoStack.pop()!;
  setMapEdited(true);
  renderMap(map);
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
  tilesetCtx.drawImage(tileset, 0, 0);
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
  if (gridCtx && map.length) {
    clearAndDrawGrid();
    drawMarkers(map);
    drawHoverCell();
  }
};

function toggleTrigger(
  tile: Tile,
  action: TileAction['action'],
  strParam?: string,
  numParam?: number,
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
      triggers.push({ action, scriptId: strParam ?? '' });
    } else {
      triggers.push({ action } as TileAction);
    }
  }
  tile.triggers = triggers.length ? triggers : undefined;
}

const handleHover = (event: MouseEvent) => {
  const { x, y } = getMousePosition(event, foregroundCanvas);
  const cam = getCamera();
  const col = Math.floor((x + cam.x) / TILE_SIZE);
  const row = Math.floor((y + cam.y) / TILE_SIZE);
  if (!hoveredCell || hoveredCell.row !== row || hoveredCell.col !== col) {
    hoveredCell = { row, col };
    renderMap(map);
  }
};

const modes: Record<TileEditMode, ModeConfig> = {
  blocking: {
    place: (row: number, col: number) => {
      map[row][col].blocked = !map[row][col].blocked;
      setMapEdited(true);
      renderMap(map);
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
        renderMap(map);
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
        renderMap(map);
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
        renderMap(map);
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
        renderMap(map);
      }
    },
  },
  bank: {
    place: (row: number, col: number) => {
      map[row][col].bank = !map[row][col].bank;
      setMapEdited(true);
      renderMap(map);
    },
  },
  avoidNpc: {
    place: (row: number, col: number) => {
      map[row][col].avoidNpc = !map[row][col].avoidNpc;
      setMapEdited(true);
      renderMap(map);
    },
  },
  fringe: {
    place: (row: number, col: number) => {
      const { startX, startY } = calculateSelectionBounds();
      const tilesPerRow = Math.floor(tilesetCanvas.width / TILE_SIZE);
      const idx = startY * tilesPerRow + startX;
      map[row][col].fringeIndex =
        map[row][col].fringeIndex === idx ? undefined : idx;
      setMapEdited(true);
      renderMap(map);
    },
  },
  mask: {
    place: (row: number, col: number) => {
      const { startX, startY } = calculateSelectionBounds();
      const tilesPerRow = Math.floor(tilesetCanvas.width / TILE_SIZE);
      const idx = startY * tilesPerRow + startX;
      map[row][col].maskIndex =
        map[row][col].maskIndex === idx ? undefined : idx;
      setMapEdited(true);
      renderMap(map);
    },
  },
  heal: {
    place: (row: number, col: number) => {
      toggleTrigger(map[row][col], 'heal');
      setMapEdited(true);
      renderMap(map);
    },
  },
  kill: {
    place: (row: number, col: number) => {
      toggleTrigger(map[row][col], 'kill');
      setMapEdited(true);
      renderMap(map);
    },
  },
  warn: {
    place: (row: number, col: number) => {
      toggleTrigger(map[row][col], 'message', '⚠️ Entering a dangerous area!');
      setMapEdited(true);
      renderMap(map);
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
      renderMap(map);
    },
  },
  sound: {
    place: (row: number, col: number) => {
      const file = getInputValue('soundFile');
      if (!file) return;
      toggleTrigger(map[row][col], 'sound', file);
      setMapEdited(true);
      renderMap(map);
    },
  },
  changeSprite: {
    place: (row: number, col: number) => {
      const spriteId = safeParseInt(getInputValue('changeSpriteId'));
      if (isNaN(spriteId)) return;
      toggleTrigger(map[row][col], 'changeSprite', undefined, spriteId);
      setMapEdited(true);
      renderMap(map);
    },
  },
  script: {
    place: (row: number, col: number) => {
      const scriptId = getInputValue('scriptId');
      if (!scriptId) return;
      toggleTrigger(map[row][col], 'script', scriptId);
      setMapEdited(true);
      renderMap(map);
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
      renderMap(map);
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
  tilesetCtx.drawImage(tileset, 0, 0);
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

const startPlacing = (event: MouseEvent) => {
  isPlacing = true;
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
  if (activeMode) {
    modes[activeMode].place(row, col);
  } else {
    placeSelectedTile(row, col);
  }
};

const placeSelectedTile = (row: number, col: number) => {
  const { startX, startY, width, height } = calculateSelectionBounds();
  for (let i = 0; i < width; i++) {
    for (let j = 0; j < height; j++) {
      if (row + j < mapHeight && col + i < mapWidth) {
        const tileIndex =
          (startY + j) * Math.floor(tilesetCanvas.width / TILE_SIZE) +
          (startX + i);
        const prev = map[row + j][col + i];
        map[row + j][col + i] = {
          ...prev,
          tileIndex,
        };
        drawTileOnCanvas(col + i, row + j, tileIndex);
      }
    }
  }
  setMapEdited(true);
};

const calculateSelectionBounds = () => {
  const startX = Math.min(selectedTile.startX, selectedTile.endX);
  const startY = Math.min(selectedTile.startY, selectedTile.endY);
  const width = Math.abs(selectedTile.startX - selectedTile.endX) + 1;
  const height = Math.abs(selectedTile.startY - selectedTile.endY) + 1;
  return { startX, startY, width, height };
};

const drawTileOnCanvas = (col: number, row: number, tileIndex: number) => {
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
  foregroundCtx.clearRect(sx, sy, TILE_SIZE, TILE_SIZE);
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
  renderMap(map);
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

export const renderMap = (tiles: Tile[][]) => {
  if (tiles) updateEditorMap(tiles, editorMusic);
  foregroundCtx.clearRect(
    0,
    0,
    foregroundCanvas.width,
    foregroundCanvas.height,
  );
  const cam = getCamera();
  const startCol = Math.max(0, Math.floor(cam.x / TILE_SIZE));
  const endCol = Math.min(
    (tiles[0]?.length ?? 0) - 1,
    Math.ceil((cam.x + foregroundCanvas.width) / TILE_SIZE),
  );
  const startRow = Math.max(0, Math.floor(cam.y / TILE_SIZE));
  const endRow = Math.min(
    tiles.length - 1,
    Math.ceil((cam.y + foregroundCanvas.height) / TILE_SIZE),
  );
  for (let rowIndex = startRow; rowIndex <= endRow; rowIndex++) {
    const row = tiles[rowIndex];
    if (!row) continue;
    for (let colIndex = startCol; colIndex <= endCol; colIndex++) {
      const tile = row[colIndex];
      if (tile && tile.tileIndex !== -1) {
        drawTileOnCanvas(colIndex, rowIndex, tile.tileIndex);
      }
    }
  }
  clearAndDrawGrid();
  drawMarkers(tiles);
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
  tiles.forEach((row, rowIndex) => {
    row.forEach((tile, colIndex) => {
      if (tile.blocked) drawMarker(colIndex, rowIndex, 'B', 'red');
      if (tile.warp) drawMarker(colIndex, rowIndex, 'W', 'blue');
      if (tile.npcSpawn) {
        drawMarker(colIndex, rowIndex, 'N', 'yellow');
        drawNpcSpawnName(colIndex, rowIndex, tile.npcSpawn);
      }
      if (tile.item) drawMarker(colIndex, rowIndex, 'I', 'orange');
      if (tile.shop) drawMarker(colIndex, rowIndex, 'S', 'green');
      if (tile.bank) drawMarker(colIndex, rowIndex, '$', '#f59e0b');
      if (tile.avoidNpc) drawMarker(colIndex, rowIndex, 'A', 'purple');
      if (tile.maskIndex !== undefined)
        drawLayerDot(colIndex, rowIndex, '#00bcd4', 'bl');
      if (tile.fringeIndex !== undefined)
        drawLayerDot(colIndex, rowIndex, '#9c27b0', 'br');
      if (tile.triggers?.some((t) => t.action === 'heal'))
        drawMarker(colIndex, rowIndex, 'H', '#00e676');
      if (tile.triggers?.some((t) => t.action === 'kill'))
        drawMarker(colIndex, rowIndex, 'K', '#ff1744');
      if (tile.triggers?.some((t) => t.action === 'message'))
        drawMarker(colIndex, rowIndex, '!', '#ff9100');
      if (tile.triggers?.some((t) => t.action === 'sound'))
        drawMarker(colIndex, rowIndex, '♪', '#00bcd4');
      if (tile.triggers?.some((t) => t.action === 'changeSprite'))
        drawMarker(colIndex, rowIndex, 'C', '#9c27b0');
      if (tile.triggers?.some((t) => t.action === 'script'))
        drawMarker(colIndex, rowIndex, 'J', '#607d8b');
      if (tile.door) drawMarker(colIndex, rowIndex, 'D', '#ff8f00');
      if (tile.conditionalBlock) drawMarker(colIndex, rowIndex, '?', '#78909c');
    });
  });
};
const drawMarker = (col: number, row: number, text: string, color: string) => {
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
  gridCtx.fillStyle = color;
  gridCtx.font = '40px Arial';
  gridCtx.fillText(text, sx + 20, sy + 35);
};

const DOT = 10;
const drawLayerDot = (
  col: number,
  row: number,
  color: string,
  corner: 'bl' | 'br',
) => {
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
  const dx = corner === 'br' ? sx + TILE_SIZE - DOT - 2 : sx + 2;
  const dy = sy + TILE_SIZE - DOT - 2;
  gridCtx.fillStyle = color;
  gridCtx.fillRect(dx, dy, DOT, DOT);
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
  gridCtx.strokeStyle = 'black';
  gridCtx.fillStyle = 'yellow';
  gridCtx.strokeText(label, sx + TILE_SIZE / 2, sy + TILE_SIZE - 6);
  gridCtx.fillText(label, sx + TILE_SIZE / 2, sy + TILE_SIZE - 6);
  gridCtx.textAlign = 'left';
  gridCtx.lineWidth = 1;
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
    result = await saveMap(map, name, type, editorMusic || undefined);
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
      tilesetCtx.drawImage(tileset, 0, 0);
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

  renderMap(map);
};

const updateEditorMap = (tiles: Tile[][], music?: string) => {
  map = tiles.map((row) => row.map((tile) => ({ ...tile })));
  originalMap = tiles.map((row) => row.map((tile) => ({ ...tile })));
  mapWidth = tiles[0]?.length ?? 20;
  mapHeight = tiles.length;
  editorMusic = music ?? '';
};

export const renderMapMask = (
  tiles: Tile[][],
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
  tiles: Tile[][],
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
