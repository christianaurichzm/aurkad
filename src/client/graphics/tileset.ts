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
  const selectedTile = { x: 0, y: 0 };

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
    tilesetCanvas.addEventListener('click', selectTile);
    foregroundCanvas.addEventListener('click', placeTile);
  }

  function selectTile(event: MouseEvent) {
    const rect = tilesetCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    selectedTile.x = Math.floor(x / tileSize);
    selectedTile.y = Math.floor(y / tileSize);
    highlightSelectedTile();
  }

  function highlightSelectedTile() {
    tilesetCtx.clearRect(0, 0, tilesetCanvas.width, tilesetCanvas.height);
    tilesetCtx.drawImage(tileset, 0, 0);
    tilesetCtx.strokeStyle = 'red';
    tilesetCtx.lineWidth = 2;
    tilesetCtx.strokeRect(
      selectedTile.x * tileSize,
      selectedTile.y * tileSize,
      tileSize,
      tileSize,
    );
  }

  function placeTile(event: MouseEvent) {
    const rect = backgroundCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const col = Math.floor(x / tileSize);
    const row = Math.floor(y / tileSize);

    console.log(`Placing tile at col: ${col}, row: ${row}`);
    console.log(`Selected tile: ${selectedTile.x}, ${selectedTile.y}`);

    backgroundCtx.clearRect(col * tileSize, row * tileSize, tileSize, tileSize);
    backgroundCtx.drawImage(
      tileset,
      selectedTile.x * tileSize,
      selectedTile.y * tileSize,
      tileSize,
      tileSize,
      col * tileSize,
      row * tileSize,
      tileSize,
      tileSize,
    );
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
