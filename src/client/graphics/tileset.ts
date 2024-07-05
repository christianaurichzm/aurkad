import { GameState, MapState } from '../../shared/types';
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

const tileSize = 32;
const selectedTile = { startX: 0, startY: 0, endX: 0, endY: 0 };
let isSelecting = false;
let isPlacing = false;
const mapWidth = Math.floor(foregroundCanvas.width / tileSize);
const mapHeight = Math.floor(foregroundCanvas.height / tileSize);
let originalMap: number[][] = [];
let map: number[][] = [];

const setupEventListeners = () => {
  tilesetCanvas.addEventListener('mousedown', startSelecting);
  tilesetCanvas.addEventListener('mousemove', updateSelection);
  tilesetCanvas.addEventListener('mouseup', endSelecting);
  foregroundCanvas.addEventListener('mousedown', startPlacing);
  foregroundCanvas.addEventListener('mousemove', placeTileWhileDragging);
  foregroundCanvas.addEventListener('mouseup', stopPlacing);
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
  selectedTile.startX = Math.floor(x / tileSize);
  selectedTile.startY = Math.floor(y / tileSize);
  isSelecting = true;
};

const updateSelection = (event: MouseEvent) => {
  if (!isSelecting) return;
  const { x, y } = getMousePosition(event, tilesetCanvas);
  selectedTile.endX = Math.floor(x / tileSize);
  selectedTile.endY = Math.floor(y / tileSize);
  highlightSelectedTile();
};

const endSelecting = (event: MouseEvent) => {
  if (!isSelecting) return;
  const { x, y } = getMousePosition(event, tilesetCanvas);
  selectedTile.endX = Math.floor(x / tileSize);
  selectedTile.endY = Math.floor(y / tileSize);
  isSelecting = false;
  highlightSelectedTile();
};

const highlightSelectedTile = () => {
  tilesetCtx.clearRect(0, 0, tilesetCanvas.width, tilesetCanvas.height);
  tilesetCtx.drawImage(tileset, 0, 0);
  tilesetCtx.strokeStyle = 'red';
  tilesetCtx.lineWidth = 2;

  const startX = Math.min(selectedTile.startX, selectedTile.endX) * tileSize;
  const startY = Math.min(selectedTile.startY, selectedTile.endY) * tileSize;
  const width =
    (Math.abs(selectedTile.startX - selectedTile.endX) + 1) * tileSize;
  const height =
    (Math.abs(selectedTile.startY - selectedTile.endY) + 1) * tileSize;

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
  const col = Math.floor(x / tileSize);
  const row = Math.floor(y / tileSize);

  const startX = Math.min(selectedTile.startX, selectedTile.endX);
  const startY = Math.min(selectedTile.startY, selectedTile.endY);
  const width = Math.abs(selectedTile.startX - selectedTile.endX) + 1;
  const height = Math.abs(selectedTile.startY - selectedTile.endY) + 1;

  for (let i = 0; i < width; i++) {
    for (let j = 0; j < height; j++) {
      if (row + j < mapHeight && col + i < mapWidth) {
        const tileIndex =
          (startY + j) * Math.floor(tilesetCanvas.width / tileSize) +
          (startX + i);

        map[row + j][col + i] = tileIndex;
        mapEdited = true;

        foregroundCtx.clearRect(
          (col + i) * tileSize,
          (row + j) * tileSize,
          tileSize,
          tileSize,
        );
        foregroundCtx.drawImage(
          tileset,
          (startX + i) * tileSize,
          (startY + j) * tileSize,
          tileSize,
          tileSize,
          (col + i) * tileSize,
          (row + j) * tileSize,
          tileSize,
          tileSize,
        );
      }
    }
  }
};

export const initTilesetEditor = () => {
  tilesetCanvas.width = tileset.width;
  tilesetCanvas.height = tileset.height;
  tilesetCtx.drawImage(tileset, 0, 0);
  setupEventListeners();
  tilesetEditorInitialized = true;
};

export const renderMap = (tiles: number[][]) => {
  const tilesPerRow = tileset.width / tileSize;
  for (let row = 0; row < mapHeight; row++) {
    for (let col = 0; col < mapWidth; col++) {
      const tileIndex = tiles[row][col];
      if (tileIndex !== -1) {
        const tileX = (tileIndex % tilesPerRow) * tileSize;
        const tileY = Math.floor(tileIndex / tilesPerRow) * tileSize;
        foregroundCtx.drawImage(
          tileset,
          tileX,
          tileY,
          tileSize,
          tileSize,
          col * tileSize,
          row * tileSize,
          tileSize,
          tileSize,
        );
      }
    }
  }
};

const drawGrid = () => {
  const width = gridCanvas.width;
  const height = gridCanvas.height;
  gridCtx.strokeStyle = '#ddd';
  gridCtx.lineWidth = 1;

  for (let x = 0; x <= width; x += tileSize) {
    gridCtx.beginPath();
    gridCtx.moveTo(x, 0);
    gridCtx.lineTo(x, height);
    gridCtx.stroke();
  }

  for (let y = 0; y <= height; y += tileSize) {
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
      originalMap = map.map((row) => [...row]);
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

      map = originalMap.map((row) => [...row]);
    }

    tilesetContainer.style.display = 'none';
    gridCanvas.style.display = 'none';
    mapEdited = false;
  } else {
    const gameState = getGameState();
    if (gameState.tiles) {
      map = gameState.tiles.map((row) => [...row]);

      originalMap = gameState.tiles.map((row) => [...row]);
    } else {
      map = Array.from({ length: mapHeight }, () => Array(mapWidth).fill(-1));
      originalMap = map.map((row) => [...row]);
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
