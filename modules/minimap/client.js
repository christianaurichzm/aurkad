// @ts-check
// Minimap, client only: a small second view of the map the client already
// holds, so nothing is fetched or sent. With no server half there is no
// `config` global; the constants below are the settings.

const SIZE = 160; // px, the long side of the minimap box
const MARGIN = 8;
const COLORS = {
  frame: 'rgba(0,0,0,0.55)',
  floor: 'rgba(255,255,255,0.22)',
  wall: 'rgba(255,255,255,0.06)',
  viewport: 'rgba(255,255,255,0.55)',
  npc: '#ef4444',
  player: '#38bdf8',
  self: '#facc15',
};

// The tile layer is redrawn only for rows whose array changed, since a map
// is thousands of rectangles and a frame is 16 ms.
let cache = null;

function tileLayerFor(map) {
  if (cache && cache.tiles === map.tiles) return cache;
  const rows = map.tiles.length;
  const cols = map.tiles[0] ? map.tiles[0].length : 0;
  if (!rows || !cols) return null;

  if (
    !cache ||
    cache.mapId !== map.id ||
    cache.cols !== cols ||
    cache.rows !== rows
  ) {
    // One pixel per tile, scaled up when drawn, so the cost follows the map
    // rather than the display size.
    const layer = document.createElement('canvas');
    layer.width = cols;
    layer.height = rows;
    const lc = layer.getContext('2d');
    if (!lc) return null;
    cache = { mapId: map.id, cols, rows, layer, lc, drawn: [], tiles: null };
  }

  for (let row = 0; row < rows; row++) {
    const line = map.tiles[row];
    if (cache.drawn[row] === line) continue;
    for (let col = 0; col < cols; col++) {
      const tile = line[col];
      cache.lc.fillStyle = tile && tile.blocked ? COLORS.wall : COLORS.floor;
      cache.lc.fillRect(col, row, 1, 1);
    }
    cache.drawn[row] = line;
  }
  cache.tiles = map.tiles;
  return cache;
}

// On the hud layer, so a night tint does not cover it.
engine.registerOverlay((ctx, cam) => {
  const map = engine.getGameState();
  const me = engine.getPlayer();
  if (!map || !map.tiles || !map.tiles.length) return;

  const tiles = tileLayerFor(map);
  if (!tiles) return;

  // SIZE and MARGIN stay in CSS pixels however large the world is drawn.
  const view = engine.getVisibleView();
  const shown = Math.max(1, view.scale);
  // The map is rarely square; keep its shape and fit the long side to SIZE.
  const scale = SIZE / shown / Math.max(tiles.cols, tiles.rows);
  const w = tiles.cols * scale;
  const h = tiles.rows * scale;

  ctx.save();
  // Undo the camera to draw in screen space, in the corner of the screen.
  ctx.translate(cam.x, cam.y);
  const x = view.x + view.width - w - MARGIN / shown;
  const y = view.y + MARGIN / shown;

  ctx.fillStyle = COLORS.frame;
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tiles.layer, x, y, w, h);

  const dot = (worldX, worldY, color, size) => {
    const px = x + (worldX / engine.TILE_SIZE) * scale;
    const py = y + (worldY / engine.TILE_SIZE) * scale;
    ctx.fillStyle = color;
    ctx.fillRect(px - size / 2, py - size / 2, size, size);
  };

  for (const npc of Object.values(map.npcs || {})) {
    if (npc.health > 0) dot(npc.position.x, npc.position.y, COLORS.npc, 3);
  }
  for (const other of Object.values(map.players || {})) {
    if (!me || other.id !== me.id) {
      dot(other.position.x, other.position.y, COLORS.player, 3);
    }
  }
  if (me) dot(me.position.x, me.position.y, COLORS.self, 4);

  // The rectangle the screen shows, skipped when the map fits on one screen
  // and it would only trace the border.
  const viewW = (view.width / engine.TILE_SIZE) * scale;
  const viewH = (view.height / engine.TILE_SIZE) * scale;
  if (viewW < w - 1 || viewH < h - 1) {
    ctx.strokeStyle = COLORS.viewport;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [sx, sy] of [
      [view.x, view.y],
      [view.x + view.width, view.y],
      [view.x + view.width, view.y + view.height],
      [view.x, view.y + view.height],
    ]) {
      const point = engine.screenToWorld(sx, sy);
      const px = x + (point.x / engine.TILE_SIZE) * scale;
      const py = y + (point.y / engine.TILE_SIZE) * scale;
      if (sx === view.x && sy === view.y) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
  }

  ctx.restore();
}, engine.OverlayLayer.hud);
