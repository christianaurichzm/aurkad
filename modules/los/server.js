// @ts-check
// Line of sight: a Bresenham ray on the tile grid, provided as 'los'
// ({ hasLOS(from, to, map) }). Npcs check it before radius-only detection.

function hasLOS(from, to, map) {
  var x0 = Math.floor(from.x / TILE_SIZE);
  var y0 = Math.floor(from.y / TILE_SIZE);
  var x1 = Math.floor(to.x / TILE_SIZE);
  var y1 = Math.floor(to.y / TILE_SIZE);

  var dx = Math.abs(x1 - x0);
  var dy = Math.abs(y1 - y0);
  var sx = x0 < x1 ? 1 : -1;
  var sy = y0 < y1 ? 1 : -1;
  var err = dx - dy;

  for (;;) {
    if (x0 === x1 && y0 === y1) return true;
    var row = map.tiles[y0];
    var tile = row && row[x0];
    if (!tile || tile.blocked) return false;
    var e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
}

provide("los", { hasLOS: hasLOS });
log("Line-of-sight module loaded");
