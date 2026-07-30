// @ts-check
// Knockback module: pushes the target 1 tile away from the attacker on damage.
// Hooked into afterDamage; skips lethal hits so dead entities don't get moved.
// Tile blocking is checked via getMapTile before applying the push.

var force = config && typeof config.force === 'number' ? config.force : 1;
var toPlayers =
  config && typeof config.applyToPlayers === 'boolean'
    ? config.applyToPlayers
    : true;
var toNpcs =
  config && typeof config.applyToNpcs === 'boolean'
    ? config.applyToNpcs
    : false;

on('afterDamage', function (payload) {
  var attacker = payload.attacker;
  var target = payload.target;

  if (payload.lethal) return;
  if (!attacker) return;
  if (target.kind === 'player' && !toPlayers) return;
  if (target.kind === 'npc' && !toNpcs) return;

  var dx = target.position.x - attacker.position.x;
  var dy = target.position.y - attacker.position.y;

  // Snap push to cardinal direction (dominant axis), 1 tile by default.
  var nx, ny;
  if (Math.abs(dx) >= Math.abs(dy)) {
    nx = target.position.x + (dx >= 0 ? force * TILE_SIZE : -force * TILE_SIZE);
    ny = target.position.y;
  } else {
    nx = target.position.x;
    ny = target.position.y + (dy >= 0 ? force * TILE_SIZE : -force * TILE_SIZE);
  }

  var col = Math.floor(nx / TILE_SIZE);
  var row = Math.floor(ny / TILE_SIZE);
  var tile = getMapTile(target.mapId, col, row);
  if (!tile || tile.blocked) return;

  target.position.x = col * TILE_SIZE;
  target.position.y = row * TILE_SIZE;
});

log('Knockback module loaded');
