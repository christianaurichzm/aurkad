import { backgroundCanvas, backgroundCtx, foregroundCanvas } from './canvas';

const tilesetContainer = document.getElementById(
  'tilesetContainer',
) as HTMLDivElement;
const tilesetCanvas = document.getElementById(
  'tilesetCanvas',
) as HTMLCanvasElement;
const tilesetCtx = tilesetCanvas.getContext('2d') as CanvasRenderingContext2D;

export function initTilesetEditor() {
  const tileset = new Image();
  tileset.src = 'Tiles.png';

  const tileSize = 32;
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

  function stopPlacing(event: MouseEvent) {
    isPlacing = false;
  }

  function placeTile(event: MouseEvent) {
    const rect = backgroundCanvas.getBoundingClientRect();
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
        backgroundCtx.clearRect(
          (col + i) * tileSize,
          (row + j) * tileSize,
          tileSize,
          tileSize,
        );
        backgroundCtx.drawImage(
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

export const toggleTilesetEditor = () => {
  if (tilesetContainer.style.display === 'block') {
    tilesetContainer.style.display = 'none';
  } else {
    tilesetContainer.style.display = 'block';
  }
};

export let tilesetEditorInitialized = false;
