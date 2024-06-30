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

export function initTilesetEditor() {
  const tileset = new Image();
  tileset.src = 'Tiles.png';

  const selectedTile = { startX: 0, startY: 0, endX: 0, endY: 0 };
  let isSelecting = false;
  let isPlacing = false;

  tileset.onload = () => {
    console.log('Tileset loaded');
    tilesetCanvas.width = tileset.width;
    tilesetCanvas.height = tileset.height;
    tilesetCtx.drawImage(tileset, 0, 0);
    setupEventListeners();
    tilesetEditorInitialized = true;
  };

  tileset.onerror = () => {
    console.error('Failed to load tileset');
  };

  function setupEventListeners() {
    tilesetCanvas.addEventListener('mousedown', startSelecting);
    tilesetCanvas.addEventListener('mousemove', updateSelection);
    tilesetCanvas.addEventListener('mouseup', endSelecting);
    foregroundCanvas.addEventListener('mousedown', startPlacing);
    foregroundCanvas.addEventListener('mousemove', placeTileWhileDragging);
    foregroundCanvas.addEventListener('mouseup', stopPlacing);
  }

  function startSelecting(event: MouseEvent) {
    const rect = tilesetCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    selectedTile.startX = Math.floor(x / tileSize);
    selectedTile.startY = Math.floor(y / tileSize);
    isSelecting = true;
  }

  function updateSelection(event: MouseEvent) {
    if (!isSelecting) return;
    const rect = tilesetCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    selectedTile.endX = Math.floor(x / tileSize);
    selectedTile.endY = Math.floor(y / tileSize);
    highlightSelectedTile();
  }

  function endSelecting(event: MouseEvent) {
    if (!isSelecting) return;
    const rect = tilesetCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    selectedTile.endX = Math.floor(x / tileSize);
    selectedTile.endY = Math.floor(y / tileSize);
    isSelecting = false;
    highlightSelectedTile();
  }

  function highlightSelectedTile() {
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
  }

  function startPlacing(event: MouseEvent) {
    isPlacing = true;
    placeTile(event);
  }

  function placeTileWhileDragging(event: MouseEvent) {
    if (isPlacing) {
      placeTile(event);
    }
  }

  function stopPlacing() {
    isPlacing = false;
  }

  function placeTile(event: MouseEvent) {
    const rect = foregroundCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const col = Math.floor(x / tileSize);
    const row = Math.floor(y / tileSize);

    const startX = Math.min(selectedTile.startX, selectedTile.endX);
    const startY = Math.min(selectedTile.startY, selectedTile.endY);
    const width = Math.abs(selectedTile.startX - selectedTile.endX) + 1;
    const height = Math.abs(selectedTile.startY - selectedTile.endY) + 1;

    for (let i = 0; i < width; i++) {
      for (let j = 0; j < height; j++) {
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
}

function drawGrid() {
  const width = gridCanvas.width;
  const height = gridCanvas.height;
  gridCtx.strokeStyle = '#ddd';
  gridCtx.lineWidth = 1;

  console.log('Drawing grid');

  for (let x = 0; x <= width; x += tileSize) {
    console.log(`Drawing vertical line at x=${x}`);
    gridCtx.beginPath();
    gridCtx.moveTo(x, 0);
    gridCtx.lineTo(x, height);
    gridCtx.stroke();
  }

  for (let y = 0; y <= height; y += tileSize) {
    console.log(`Drawing horizontal line at y=${y}`);
    gridCtx.beginPath();
    gridCtx.moveTo(0, y);
    gridCtx.lineTo(width, y);
    gridCtx.stroke();
  }
}

function initializeGrid() {
  console.log('Initializing grid canvas size');
  gridCanvas.width = foregroundCanvas.width;
  gridCanvas.height = foregroundCanvas.height;
  drawGrid();
}

export const toggleTilesetEditor = () => {
  if (tilesetContainer.style.display === 'block') {
    tilesetContainer.style.display = 'none';
    gridCanvas.style.display = 'none';
  } else {
    tilesetContainer.style.display = 'block';
    gridCanvas.style.display = 'block';
  }
};

export let tilesetEditorInitialized = false;

initializeGrid();
