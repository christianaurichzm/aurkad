// Archery module, server entry. A player equips an arrow type, kept in
// player data, and a shot uses its damage, or the configured power with
// none equipped. The arrow's sprite goes out with projectile:fire so the
// client draws the right one.

const defaultPower = (config && config.power) || 8;
const rangeTiles = (config && config.rangeTiles) || 6;
const cooldownMs = (config && config.cooldownMs) || 600;

const cooldowns = {}; // playerName -> readyAtMs
const isEnemy = (n) => n.behavior === 'aggressive' || n.behavior === 'hostile';
const HALF = TILE_SIZE / 2;

function getEquippedArrow(player) {
  const id = getPlayerData(player, 'equippedArrow');
  return id != null ? getArrow(Number(id)) : undefined;
}

function pushState(player) {
  const arrow = getEquippedArrow(player);
  sendEvent(player, 'archery:state', {
    equipped: arrow || null,
    arrows: getArrows(),
  });
}

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
    if (dist < bestDist) { bestDist = dist; best = e; }
  }
  return best;
}

on('customAction', ({ player, channel, payload }) => {
  if (channel === 'archery:equip') {
    const id = payload && Number(payload.id);
    const arrow = id ? getArrow(id) : undefined;
    setPlayerData(player, 'equippedArrow', arrow ? arrow.id : null);
    pushState(player);
    return;
  }

  if (channel === 'archery:request') {
    pushState(player);
    return;
  }

  if (channel !== 'shoot') return;

  const now = Date.now();
  if ((cooldowns[player.name] || 0) > now) return;
  cooldowns[player.name] = now + cooldownMs;

  const arrow = getEquippedArrow(player);
  const damage = arrow ? arrow.damage : defaultPower;
  const sprite = arrow ? arrow.sprite : undefined;

  const rangePx = rangeTiles * TILE_SIZE;
  const fromX = player.position.x + HALF;
  const fromY = player.position.y + HALF;

  const target = targetInFront(player, rangePx);
  let toX, toY;
  if (target) {
    toX = target.position.x + HALF;
    toY = target.position.y + HALF;
    dealDamage(target, damage, player);
  } else {
    const d = player.direction;
    toX = fromX + (d === 2 ? rangePx : d === 1 ? -rangePx : 0);
    toY = fromY + (d === 0 ? rangePx : d === 3 ? -rangePx : 0);
  }

  sendMapEvent(player.mapId, 'projectile:fire', { fromX, fromY, toX, toY, duration: 250, sprite });
});

on('playerJoin', ({ player }) => pushState(player));

log('Archery module ready (press R to shoot).');
