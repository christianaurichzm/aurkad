// Archery module, server entry. A 'shoot' action finds the nearest enemy
// in the player's facing line within range, applies dealDamage and sends
// projectile:fire so nearby clients draw the arrow; a miss still flies to
// the edge of range.

const power = (config && config.power) || 8;
const rangeTiles = (config && config.rangeTiles) || 6;
const cooldownMs = (config && config.cooldownMs) || 600;

const cooldowns = {}; // playerName -> readyAtMs
const isEnemy = (n) => n.behavior === 'aggressive' || n.behavior === 'hostile';
const HALF = TILE_SIZE / 2;

// Nearest enemy roughly in front of the player (within a half-tile of the
// facing line) and within range. Direction: 0 Down, 1 Left, 2 Right, 3 Up.
function targetInFront(player, rangePx) {
  let best = null;
  let bestDist = Infinity;
  for (const e of getNearbyNpcs(player.mapId, player.position.x, player.position.y, rangePx)) {
    if (!isEnemy(e)) continue;
    const dx = e.position.x - player.position.x;
    const dy = e.position.y - player.position.y;
    let inFront = false;
    if (player.direction === 2) inFront = dx > 0 && Math.abs(dy) <= HALF;
    else if (player.direction === 1) inFront = dx < 0 && Math.abs(dy) <= HALF;
    else if (player.direction === 0) inFront = dy > 0 && Math.abs(dx) <= HALF;
    else if (player.direction === 3) inFront = dy < 0 && Math.abs(dx) <= HALF;
    if (!inFront) continue;
    const dist = Math.abs(dx) + Math.abs(dy);
    if (dist < bestDist) {
      bestDist = dist;
      best = e;
    }
  }
  return best;
}

on('customAction', ({ player, channel }) => {
  if (channel !== 'shoot') return;

  const now = Date.now();
  if ((cooldowns[player.name] || 0) > now) return;
  cooldowns[player.name] = now + cooldownMs;

  const rangePx = rangeTiles * TILE_SIZE;
  const fromX = player.position.x + HALF;
  const fromY = player.position.y + HALF;

  const target = targetInFront(player, rangePx);
  let toX;
  let toY;
  if (target) {
    toX = target.position.x + HALF;
    toY = target.position.y + HALF;
    dealDamage(target, power, player);
  } else {
    const d = player.direction;
    toX = fromX + (d === 2 ? rangePx : d === 1 ? -rangePx : 0);
    toY = fromY + (d === 0 ? rangePx : d === 3 ? -rangePx : 0);
  }

  sendMapEvent(player.mapId, 'projectile:fire', { fromX, fromY, toX, toY, duration: 250 });
});

log('Archery module ready (press R to shoot).');
