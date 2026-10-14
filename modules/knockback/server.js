// @ts-check
// Knockback module: on afterDamage, pushes the target a tile away from the
// attacker, skipping lethal hits, and only where it could stand (canStand).

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
  if (!canStand(target, col * TILE_SIZE, row * TILE_SIZE)) return;

  // teleportPlayer ends a step in progress, so the client draws the push
  // rather than the walk.
  if (target.kind === 'player') {
    teleportPlayer(target, target.mapId, col, row);
  } else {
    target.position.x = col * TILE_SIZE;
    target.position.y = row * TILE_SIZE;
  }
});

log('Knockback module loaded');
