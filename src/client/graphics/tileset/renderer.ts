import { TILE_SIZE } from '../../../shared/constants';
import { Tile } from '../../../shared/types';
import { tileset } from '../../io/files';
import { foregroundCtx } from '../canvas';

let gridCanvas: HTMLCanvasElement;
let gridCtx: CanvasRenderingContext2D;
let hoveredCell: { row: number; col: number } | null = null;

export function initRenderer(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
) {
  gridCanvas = canvas;
  gridCtx = ctx;
}

export function setHoveredCell(cell: { row: number; col: number } | null) {
  hoveredCell = cell;
}

export const drawTileOnCanvas = (
  col: number,
  row: number,
  tileIndex: number,
) => {
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

export const drawGrid = () => {
  if (!gridCtx || !gridCanvas) return;
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

const drawMarker = (col: number, row: number, text: string, color: string) => {
  if (!gridCtx) return;
  gridCtx.fillStyle = color;
  gridCtx.font = '40px Arial';
  gridCtx.fillText(text, col * TILE_SIZE + 20, row * TILE_SIZE + 35);
};

export const drawMarkers = (tiles: Tile[][]) => {
  tiles.forEach((row, rowIndex) => {
    row.forEach((tile, colIndex) => {
      if (tile.blocked) drawMarker(colIndex, rowIndex, 'B', 'red');
      if (tile.warp) drawMarker(colIndex, rowIndex, 'W', 'blue');
      if (tile.npcSpawn) drawMarker(colIndex, rowIndex, 'N', 'yellow');
      if (tile.item) drawMarker(colIndex, rowIndex, 'I', 'orange');
      if (tile.shop) drawMarker(colIndex, rowIndex, 'S', 'green');
      if (tile.avoidNpc) drawMarker(colIndex, rowIndex, 'A', 'purple');
    });
  });
};

export const clearAndDrawGrid = () => {
  if (!gridCtx || !gridCanvas) return;
  gridCtx.clearRect(0, 0, gridCanvas.width, gridCanvas.height);
  drawGrid();
};

export const renderMapTiles = (tiles: Tile[][]) => {
  if (!tiles) return;
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
