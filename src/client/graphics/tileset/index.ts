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
import { saveMap } from '../../io/network';
import { foregroundCanvas, foregroundCtx, fringeCtx } from '../canvas';
import { useUIStore } from '../../stores/uiStore';

type ModeConfig = {
  place: (row: number, col: number) => void;
};

let gridCanvas: HTMLCanvasElement;
let gridCtx: CanvasRenderingContext2D;

let tilesetCanvas: HTMLCanvasElement;
let tilesetCtx: CanvasRenderingContext2D;

export let tilesetEditorInitialized = false;

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
  tilesetEditorInitialized = true;
  mapWidth = Math.floor(foregroundCanvas.width / TILE_SIZE);
  mapHeight = Math.floor(foregroundCanvas.height / TILE_SIZE);
};

const selectedTile = { startX: 0, startY: 0, endX: 0, endY: 0 };
let isSelecting = false;
let isPlacing = false;
let activeMode: TileEditMode | null = null;
let mapWidth: number;
let mapHeight: number;
let originalMap: Tile[][] = [];
let map: Tile[][] = [];
let hoveredCell: { row: number; col: number } | null = null;

function toggleTrigger(tile: Tile, action: TileAction['action'], text?: string) {
  const triggers = tile.triggers ?? [];
  const i = triggers.findIndex((t) => t.action === action);
  if (i >= 0) {
    triggers.splice(i, 1);
  } else {
    triggers.push(action === 'message' ? { action, text: text ?? '' } : { action } as TileAction);
  }
  tile.triggers = triggers.length ? triggers : undefined;
}

const handleHover = (event: MouseEvent) => {
  const { x, y } = getMousePosition(event, foregroundCanvas);
  const col = Math.floor(x / TILE_SIZE);
  const row = Math.floor(y / TILE_SIZE);
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
      const mapTo = getInputValue('mapTo');
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
  avoidNpc: {
    place: (row: number, col: number) => {
      map[row][col].avoidNpc = !map[row][col].avoidNpc;
      setMapEdited(true);
      renderMap(map);
    },
  },
  fringe: {
    place: (row: number, col: number) => {
      map[row][col].fringe = !map[row][col].fringe;
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
  const col = Math.floor(x / TILE_SIZE);
  const row = Math.floor(y / TILE_SIZE);
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
  const tilesPerRow = tileset.width / TILE_SIZE;
  const tileX = (tileIndex % tilesPerRow) * TILE_SIZE;
  const tileY = Math.floor(tileIndex / tilesPerRow) * TILE_SIZE;
  foregroundCtx.clearRect(
    col * TILE_SIZE,
    row * TILE_SIZE,
    TILE_SIZE,
    TILE_SIZE,
  );
  foregroundCtx.drawImage(
    tileset,
    tileX,
    tileY,
    TILE_SIZE,
    TILE_SIZE,
    col * TILE_SIZE,
    row * TILE_SIZE,
    TILE_SIZE,
    TILE_SIZE,
  );
};

export const fillMap = () => {
  if (!tilesetCanvas) return;
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
export const toggleAvoidNpc = () => toggleMode('avoidNpc');
export const toggleFringe = () => toggleMode('fringe');
export const toggleHeal = () => toggleMode('heal');
export const toggleKill = () => toggleMode('kill');
export const toggleWarn = () => toggleMode('warn');

const setupEventListeners = () => {
  addEvent('tilesetCanvas', 'mousedown', startSelecting);
  addEvent('tilesetCanvas', 'mousemove', updateSelection);
  addEvent('tilesetCanvas', 'mouseup', endSelecting);
  addEvent('foregroundCanvas', 'mousedown', startPlacing);
  addEvent('foregroundCanvas', 'mousemove', placeTileWhileDragging);
  addEvent('foregroundCanvas', 'mousemove', handleHover);
  addEvent('foregroundCanvas', 'mouseup', stopPlacing);
};

const removeEventListeners = () => {
  removeEvent('tilesetCanvas', 'mousedown', startSelecting);
  removeEvent('tilesetCanvas', 'mousemove', updateSelection);
  removeEvent('tilesetCanvas', 'mouseup', endSelecting);
  removeEvent('foregroundCanvas', 'mousedown', startPlacing);
  removeEvent('foregroundCanvas', 'mousemove', placeTileWhileDragging);
  removeEvent('foregroundCanvas', 'mousemove', handleHover);
  removeEvent('foregroundCanvas', 'mouseup', stopPlacing);
};

export const renderMap = (tiles: Tile[][]) => {
  if (tiles) updateEditorMap(tiles);
  tiles.forEach((row, rowIndex) => {
    row.forEach((tile, colIndex) => {
      if (tile.tileIndex !== -1) {
        drawTileOnCanvas(colIndex, rowIndex, tile.tileIndex);
      }
    });
  });
  clearAndDrawGrid();
  drawMarkers(tiles);
  drawHoverCell();
};

const drawHoverCell = () => {
  if (!hoveredCell || !gridCtx) return;
  const { row, col } = hoveredCell;
  gridCtx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  gridCtx.fillRect(col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
  gridCtx.fillStyle = 'black';
  gridCtx.font = '12px Arial';
  gridCtx.fillText(
    `(${col}, ${row})`,
    col * TILE_SIZE + 4,
    row * TILE_SIZE + 24,
  );
};

const drawGrid = () => {
  const width = gridCanvas.width;
  const height = gridCanvas.height;
  gridCtx.strokeStyle = '#ddd';
  gridCtx.lineWidth = 1;
  for (let x = 0; x <= width; x += TILE_SIZE) {
    gridCtx.beginPath();
    gridCtx.moveTo(x, 0);
    gridCtx.lineTo(x, height);
    gridCtx.stroke();
  }
  for (let y = 0; y <= height; y += TILE_SIZE) {
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
      if (tile.npcSpawn) drawMarker(colIndex, rowIndex, 'N', 'yellow');
      if (tile.item) drawMarker(colIndex, rowIndex, 'I', 'orange');
      if (tile.shop) drawMarker(colIndex, rowIndex, 'S', 'green');
      if (tile.avoidNpc) drawMarker(colIndex, rowIndex, 'A', 'purple');
      if (tile.fringe) drawMarker(colIndex, rowIndex, 'F', 'cyan');
      if (tile.triggers?.some((t) => t.action === 'heal')) drawMarker(colIndex, rowIndex, 'H', '#00e676');
      if (tile.triggers?.some((t) => t.action === 'kill')) drawMarker(colIndex, rowIndex, 'K', '#ff1744');
      if (tile.triggers?.some((t) => t.action === 'message')) drawMarker(colIndex, rowIndex, '!', '#ff9100');
    });
  });
};
const drawMarker = (col: number, row: number, text: string, color: string) => {
  if (!gridCtx) return;
  gridCtx.fillStyle = color;
  gridCtx.font = '40px Arial';
  gridCtx.fillText(text, col * TILE_SIZE + 20, row * TILE_SIZE + 35);
};

export const saveCurrentMap = async (name: string, type: MapType) => {
  await withLoading('saveButton', async () => {
    await saveMap(map, name, type);
    setMapEdited(false);
    originalMap = map.map((row) => row.map((tile) => ({ ...tile })));
  });
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
  }

  renderMap(map);
};

const updateEditorMap = (tiles: Tile[][]) => {
  map = tiles.map((row) => row.map((tile) => ({ ...tile })));
  originalMap = tiles.map((row) => row.map((tile) => ({ ...tile })));
};

export const renderMapFringe = (tiles: Tile[][]) => {
  if (!fringeCtx || !tiles) return;
  const tilesPerRow = tileset.width / TILE_SIZE;
  tiles.forEach((row, rowIndex) => {
    row.forEach((tile, colIndex) => {
      if (tile.fringe && tile.tileIndex !== -1) {
        const tileX = (tile.tileIndex % tilesPerRow) * TILE_SIZE;
        const tileY = Math.floor(tile.tileIndex / tilesPerRow) * TILE_SIZE;
        fringeCtx.drawImage(
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
    });
  });
};
