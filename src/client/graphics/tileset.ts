import {
  getEl,
  getInputValue,
  setVisibility,
  show,
  hide,
  setText,
  addEvent,
  safeParseInt,
  clearChildren,
  withLoading,
  batchSetInputs,
  removeEvent,
} from '../../server/domHelpers';
import { TILE_SIZE } from '../../shared/constants';
import { Tile, TileEditMode } from '../../shared/types';
import { getGameState } from '../core/gameState';
import { tileset } from '../io/files';
import { fetchItems, fetchNpcs, saveMap } from '../io/network';
import { setupAsyncSelect } from '../ui/asyncSelect';
import { foregroundCanvas, foregroundCtx } from './canvas';

const gridCanvas = getEl<HTMLCanvasElement>('gridCanvas')!;
const gridCtx = gridCanvas.getContext('2d')!;
const tilesetCanvas = getEl<HTMLCanvasElement>('tilesetCanvas')!;
const tilesetCtx = tilesetCanvas.getContext('2d')!;
const blockButton = getEl<HTMLButtonElement>('blockButton')!;
const warpButton = getEl<HTMLButtonElement>('warpButton')!;
const npcButton = getEl<HTMLButtonElement>('npcButton')!;
const itemButton = getEl<HTMLButtonElement>('itemButton')!;
const tilesetContainer = getEl<HTMLDivElement>('tilesetContainer')!;

const selectedTile = { startX: 0, startY: 0, endX: 0, endY: 0 };
let isSelecting = false;
let isPlacing = false;
let activeMode: TileEditMode | null = null;
const mapWidth = Math.floor(foregroundCanvas.width / TILE_SIZE);
const mapHeight = Math.floor(foregroundCanvas.height / TILE_SIZE);
let originalMap: Tile[][] = [];
let map: Tile[][] = [];
export let mapEdited = false;
let hoveredCell: { row: number; col: number } | null = null;

const handleHover = (event: MouseEvent) => {
  const { x, y } = getMousePosition(event, foregroundCanvas);
  const col = Math.floor(x / TILE_SIZE);
  const row = Math.floor(y / TILE_SIZE);
  if (!hoveredCell || hoveredCell.row !== row || hoveredCell.col !== col) {
    hoveredCell = { row, col };
    renderMap(map);
  }
};

type ModeConfig = {
  button: HTMLButtonElement;
  textOn: string;
  textOff: string;
  styleOn: string;
  styleOff: string;
  place: (row: number, col: number) => void;
};

const modes: Record<TileEditMode, ModeConfig> = {
  blocking: {
    button: blockButton,
    textOn: 'Blocking Mode: ON',
    textOff: 'Blocking Mode: OFF',
    styleOn: 'red',
    styleOff: '',
    place: (row: number, col: number) => {
      map[row][col].blocked = !map[row][col].blocked;
      mapEdited = true;
      renderMap(map);
    },
  },
  warping: {
    button: warpButton,
    textOn: 'Warp Mode: ON',
    textOff: 'Warp Mode: OFF',
    styleOn: 'red',
    styleOff: '',
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
        mapEdited = true;
        renderMap(map);
      }
    },
  },
  npc: {
    button: npcButton,
    textOn: 'Npc Mode: ON',
    textOff: 'Npc Mode: OFF',
    styleOn: 'red',
    styleOff: '',
    place: (row: number, col: number) => {
      const npc = getInputValue('npc');
      if (npc) {
        if (map[row][col].npcSpawn) {
          map[row][col].npcSpawn = undefined;
        } else {
          map[row][col].npcSpawn = npc;
        }
        mapEdited = true;
        renderMap(map);
      }
    },
  },
  item: {
    button: itemButton,
    textOn: 'Item Mode: ON',
    textOff: 'Item Mode: OFF',
    styleOn: 'red',
    styleOff: '',
    place: (row: number, col: number) => {
      const item = getInputValue('item');
      if (item) {
        if (map[row][col].item) {
          map[row][col].item = undefined;
        } else {
          map[row][col].item = safeParseInt(item);
        }
        mapEdited = true;
        renderMap(map);
      }
    },
  },
};

const toggleMode = (mode: TileEditMode) => {
  activeMode = activeMode === mode ? null : mode;
  (Object.keys(modes) as TileEditMode[]).forEach((key) => {
    const isActive = activeMode === key;
    const m = modes[key];
    m.button.textContent = isActive ? m.textOn : m.textOff;
    m.button.style.backgroundColor = isActive ? m.styleOn : m.styleOff;
    const group = getEl(`${key}Group`);
    if (group) group.classList.toggle('active', isActive);
  });
};

const getMousePosition = (event: MouseEvent, canvas: HTMLCanvasElement) => {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
};

const startSelecting = (event: MouseEvent) => {
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
        map[row + j][col + i] = {
          tileIndex,
          blocked: map[row + j][col + i].blocked,
          warp: map[row + j][col + i].warp,
        };
        drawTileOnCanvas(col + i, row + j, tileIndex);
      }
    }
  }
  mapEdited = true;
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

const toggleBlocking = () => toggleMode('blocking');
const toggleWarping = () => toggleMode('warping');
const toggleNpc = () => toggleMode('npc');
const toggleItem = () => toggleMode('item');

const setupEventListeners = () => {
  addEvent('tilesetCanvas', 'mousedown', startSelecting);
  addEvent('tilesetCanvas', 'mousemove', updateSelection);
  addEvent('tilesetCanvas', 'mouseup', endSelecting);
  addEvent('foregroundCanvas', 'mousedown', startPlacing);
  addEvent('foregroundCanvas', 'mousemove', placeTileWhileDragging);
  addEvent('foregroundCanvas', 'mousemove', handleHover);
  addEvent('foregroundCanvas', 'mouseup', stopPlacing);

  addEvent('blockButton', 'click', toggleBlocking);
  addEvent('warpButton', 'click', toggleWarping);
  addEvent('npcButton', 'click', toggleNpc);
  addEvent('itemButton', 'click', toggleItem);
};

const removeEventListeners = () => {
  removeEvent('tilesetCanvas', 'mousedown', startSelecting);
  removeEvent('tilesetCanvas', 'mousemove', updateSelection);
  removeEvent('tilesetCanvas', 'mouseup', endSelecting);
  removeEvent('foregroundCanvas', 'mousedown', startPlacing);
  removeEvent('foregroundCanvas', 'mousemove', placeTileWhileDragging);
  removeEvent('foregroundCanvas', 'mousemove', handleHover);
  removeEvent('foregroundCanvas', 'mouseup', stopPlacing);

  removeEvent('blockButton', 'click', toggleBlocking);
  removeEvent('warpButton', 'click', toggleWarping);
  removeEvent('npcButton', 'click', toggleNpc);
  removeEvent('itemButton', 'click', toggleItem);
};

export const initTilesetEditor = () => {
  tilesetCanvas.width = tileset.width;
  tilesetCanvas.height = tileset.height;
  tilesetCtx.drawImage(tileset, 0, 0);
  setupEventListeners();
  initializeGrid();
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
  if (!hoveredCell) return;
  const { row, col } = hoveredCell;
  gridCtx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  gridCtx.fillRect(col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
  gridCtx.fillStyle = 'black';
  gridCtx.font = '12px Arial';
  gridCtx.fillText(
    `(${col * TILE_SIZE}, ${row * TILE_SIZE})`,
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

const initializeGrid = () => {
  gridCanvas.width = foregroundCanvas.width;
  gridCanvas.height = foregroundCanvas.height;
  drawGrid();
};
const clearAndDrawGrid = () => {
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
    });
  });
};
const drawMarker = (col: number, row: number, text: string, color: string) => {
  gridCtx.fillStyle = color;
  gridCtx.font = '40px Arial';
  gridCtx.fillText(text, col * TILE_SIZE + 20, row * TILE_SIZE + 35);
};

const saveCurrentMap = async () => {
  await withLoading('saveButton', async () => {
    try {
      await saveMap(map);
      console.log('Map saved successfully');
      mapEdited = false;
      originalMap = map.map((row) => row.map((tile) => ({ ...tile })));
    } catch (error) {
      console.error('Error saving map:', error);
    }
  });
};

export const toggleTilesetEditor = () => {
  const isEditorOpen = tilesetContainer.style.display === 'flex';
  if (isEditorOpen) {
    if (mapEdited) {
      const discardConfirmed = confirm(
        'You have unsaved changes. Are you sure you want to exit without saving?',
      );
      if (discardConfirmed) {
        map = originalMap.map((row) => row.map((tile) => ({ ...tile })));
      }
    }
    removeEventListeners();
    hide('tilesetContainer');
    hide('gridCanvas');
    mapEdited = false;
    activeMode = null;
  } else {
    const gameState = getGameState();
    if (gameState.tiles) {
      updateEditorMap(gameState.tiles);
    } else {
      map = Array.from({ length: mapHeight }, () =>
        Array.from({ length: mapWidth }, () => ({
          tileIndex: -1,
          blocked: false,
          warp: undefined,
        })),
      );
      originalMap = map.map((row) => row.map((tile) => ({ ...tile })));
    }
    setupEventListeners();
    show('tilesetContainer', 'flex');
    show('gridCanvas', 'block');
  }
  renderMap(map);
};

setupAsyncSelect('npc', 'Select an NPC', fetchNpcs, (npc) => ({
  value: String(npc.id),
  label: `${npc.id} - ${npc.name}`,
}));
setupAsyncSelect('item', 'Select an item', fetchItems, (item) => ({
  value: String(item.id),
  label: `${item.id} - ${item.name}`,
}));

const updateEditorMap = (tiles: Tile[][]) => {
  map = tiles.map((row) => row.map((tile) => ({ ...tile })));
  originalMap = tiles.map((row) => row.map((tile) => ({ ...tile })));
};

export const tilesetEditorInitialized = false;

document.addEventListener('DOMContentLoaded', () => {
  const saveButton = getEl('saveButton');
  if (saveButton) {
    addEvent('saveButton', 'click', async () => {
      if (mapEdited) {
        const userConfirmed = confirm(
          'You have unsaved changes. Would you like to save them?',
        );
        if (userConfirmed) {
          await saveCurrentMap();
        }
      }
    });
  } else {
    console.error('Save button not found');
  }
});
