import { TILE_SIZE } from '../../shared/constants';
import { Tile } from '../../shared/types';
import { getGameState } from '../core/gameState';
import { tileset } from '../io/files';
import { saveMap } from '../io/network';
import { foregroundCanvas, foregroundCtx } from './canvas';

const gridCanvas = document.getElementById('gridCanvas') as HTMLCanvasElement;
const gridCtx = gridCanvas.getContext('2d') as CanvasRenderingContext2D;
const tilesetContainer = document.getElementById(
  'tilesetContainer',
) as HTMLDivElement;
const tilesetCanvas = document.getElementById(
  'tilesetCanvas',
) as HTMLCanvasElement;
const tilesetCtx = tilesetCanvas.getContext('2d') as CanvasRenderingContext2D;

const blockButton = document.getElementById('blockButton') as HTMLButtonElement;

const selectedTile = { startX: 0, startY: 0, endX: 0, endY: 0 };
let isSelecting = false;
let isPlacing = false;
let isBlocking = false;
const mapWidth = Math.floor(foregroundCanvas.width / TILE_SIZE);
const mapHeight = Math.floor(foregroundCanvas.height / TILE_SIZE);
let originalMap: Tile[][] = [];
let map: Tile[][] = [];

const setupEventListeners = () => {
  tilesetCanvas.addEventListener('mousedown', startSelecting);
  tilesetCanvas.addEventListener('mousemove', updateSelection);
  tilesetCanvas.addEventListener('mouseup', endSelecting);
  foregroundCanvas.addEventListener('mousedown', startPlacing);
  foregroundCanvas.addEventListener('mousemove', placeTileWhileDragging);
  foregroundCanvas.addEventListener('mouseup', stopPlacing);

  blockButton.addEventListener('click', toggleBlockMode);
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
  isSelecting = true;
};

const updateSelection = (event: MouseEvent) => {
  if (!isSelecting) return;
  const { x, y } = getMousePosition(event, tilesetCanvas);
  selectedTile.endX = Math.floor(x / TILE_SIZE);
  selectedTile.endY = Math.floor(y / TILE_SIZE);
  highlightSelectedTile();
};

const endSelecting = (event: MouseEvent) => {
  if (!isSelecting) return;
  const { x, y } = getMousePosition(event, tilesetCanvas);
  selectedTile.endX = Math.floor(x / TILE_SIZE);
  selectedTile.endY = Math.floor(y / TILE_SIZE);
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
  if (isPlacing) {
    placeTile(event);
  }
};

const stopPlacing = () => {
  isPlacing = false;
};

const placeTile = (event: MouseEvent) => {
  const { x, y } = getMousePosition(event, foregroundCanvas);
  const col = Math.floor(x / TILE_SIZE);
  const row = Math.floor(y / TILE_SIZE);

  if (isBlocking) {
    map[row][col].blocked = !map[row][col].blocked;
    mapEdited = true;
    renderMap(map);
  } else {
    const startX = Math.min(selectedTile.startX, selectedTile.endX);
    const startY = Math.min(selectedTile.startY, selectedTile.endY);
    const width = Math.abs(selectedTile.startX - selectedTile.endX) + 1;
    const height = Math.abs(selectedTile.startY - selectedTile.endY) + 1;

    for (let i = 0; i < width; i++) {
      for (let j = 0; j < height; j++) {
        if (row + j < mapHeight && col + i < mapWidth) {
          const tileIndex =
            (startY + j) * Math.floor(tilesetCanvas.width / TILE_SIZE) +
            (startX + i);

          map[row + j][col + i] = {
            tileIndex,
            blocked: map[row + j][col + i].blocked,
          };
          mapEdited = true;

          foregroundCtx.clearRect(
            (col + i) * TILE_SIZE,
            (row + j) * TILE_SIZE,
            TILE_SIZE,
            TILE_SIZE,
          );
          foregroundCtx.drawImage(
            tileset,
            (startX + i) * TILE_SIZE,
            (startY + j) * TILE_SIZE,
            TILE_SIZE,
            TILE_SIZE,
            (col + i) * TILE_SIZE,
            (row + j) * TILE_SIZE,
            TILE_SIZE,
            TILE_SIZE,
          );
        }
      }
    }
  }
};

const toggleBlockMode = () => {
  isBlocking = !isBlocking;
  blockButton.textContent = isBlocking
    ? 'Blocking Mode: ON'
    : 'Blocking Mode: OFF';
  blockButton.style.backgroundColor = isBlocking ? 'red' : '';
};

export const initTilesetEditor = () => {
  tilesetCanvas.width = tileset.width;
  tilesetCanvas.height = tileset.height;
  tilesetCtx.drawImage(tileset, 0, 0);
  setupEventListeners();
  tilesetEditorInitialized = true;
};

export const renderMap = (tiles: Tile[][]) => {
  const tilesPerRow = tileset.width / TILE_SIZE;
  for (let row = 0; row < mapHeight; row++) {
    for (let col = 0; col < mapWidth; col++) {
      const tile = tiles[row][col];
      if (tile.tileIndex !== -1) {
        const tileX = (tile.tileIndex % tilesPerRow) * TILE_SIZE;
        const tileY = Math.floor(tile.tileIndex / tilesPerRow) * TILE_SIZE;
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
      }
    }
  }

  gridCtx.clearRect(0, 0, gridCanvas.width, gridCanvas.height);
  drawGrid();
  for (let row = 0; row < mapHeight; row++) {
    for (let col = 0; col < mapWidth; col++) {
      if (tiles[row][col].blocked) {
        gridCtx.fillStyle = 'red';
        gridCtx.font = '20px Arial';
        gridCtx.fillText('B', col * TILE_SIZE + 10, row * TILE_SIZE + 20);
      }
    }
  }
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

const saveCurrentMap = () => {
  return saveMap(map)
    .then(() => {
      console.log('Map saved successfully');
      mapEdited = false;
      originalMap = map.map((row) => row.map((tile) => ({ ...tile })));
    })
    .catch((error) => {
      console.error('Error saving map:', error);
    });
};

export const toggleTilesetEditor = () => {
  const isEditorOpen = tilesetContainer.style.display === 'block';

  if (isEditorOpen) {
    if (mapEdited) {
      const discardConfirmed = confirm(
        'You have unsaved changes. Are you sure you want to exit without saving?',
      );
      if (!discardConfirmed) {
        return;
      }

      map = originalMap.map((row) => row.map((tile) => ({ ...tile })));
    }

    tilesetContainer.style.display = 'none';
    gridCanvas.style.display = 'none';
    mapEdited = false;
  } else {
    const gameState = getGameState();
    if (gameState.tiles) {
      map = gameState.tiles.map((row) =>
        row.map((tile) => ({
          tileIndex: tile.tileIndex,
          blocked: tile.blocked,
        })),
      );

      originalMap = gameState.tiles.map((row) =>
        row.map((tile) => ({
          tileIndex: tile.tileIndex,
          blocked: tile.blocked,
        })),
      );
    } else {
      map = Array.from({ length: mapHeight }, () =>
        Array.from({ length: mapWidth }, () => ({
          tileIndex: -1,
          blocked: false,
        })),
      );
      originalMap = map.map((row) => row.map((tile) => ({ ...tile })));
    }

    tilesetContainer.style.display = 'block';
    gridCanvas.style.display = 'block';
  }

  renderMap(map);
};

export let tilesetEditorInitialized = false;

let mapEdited = false;

document.addEventListener('DOMContentLoaded', () => {
  const saveButton = document.getElementById('saveButton');
  if (saveButton) {
    saveButton.addEventListener('click', () => {
      const userConfirmed = confirm(
        'You have unsaved changes. Would you like to save them?',
      );
      if (userConfirmed) {
        saveCurrentMap();
      }
    });
  } else {
    console.error('Save button not found');
  }
});

initializeGrid();
