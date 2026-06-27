const defaultRangeTiles = (config && config.rangeTiles) || 6;
const defaultTileSpeed  = 8;
const cooldownMs        = (config && config.cooldownMs) || 600;
const TICK_HZ           = 20;
const HALF              = TILE_SIZE / 2;

const cooldownTicks  = Math.ceil(cooldownMs / 1000 * TICK_HZ);
const cooldowns      = {};
const isEnemy        = (n) => n.behavior === 'aggressive' || n.behavior === 'hostile';
const projectiles    = [];

function getEquippedArrow(player) {
  const weaponId = player.equipped && player.equipped.weapon;
  if (!weaponId) return undefined;
  const item = getItem(weaponId);
  if (!item || !item.arrowId) return undefined;
  return getArrow(item.arrowId);
}

function clampEndpoint(mapId, toX, toY) {
  const size = getMapSize(mapId);
  if (!size) return { toX, toY };
  return {
    toX: Math.max(0, Math.min(size.cols * TILE_SIZE, toX)),
    toY: Math.max(0, Math.min(size.rows * TILE_SIZE, toY)),
  };
}

function aimEndpoint(player, rangePx) {
  let best = null;
  let bestDist = Infinity;
  for (const e of getNearbyNpcs(player.mapId, player.position.x, player.position.y, rangePx)) {
    if (!isEnemy(e)) continue;
    const dx = e.position.x - player.position.x;
    const dy = e.position.y - player.position.y;
    let inFront = false;
    if (player.direction === 2) inFront = dx > 0  && Math.abs(dy) <= HALF;
    else if (player.direction === 1) inFront = dx < 0  && Math.abs(dy) <= HALF;
    else if (player.direction === 0) inFront = dy > 0  && Math.abs(dx) <= HALF;
    else if (player.direction === 3) inFront = dy < 0  && Math.abs(dx) <= HALF;
    if (!inFront) continue;
    const dist = Math.abs(dx) + Math.abs(dy);
    if (dist < bestDist) { bestDist = dist; best = e; }
  }
  if (best) return { toX: best.position.x + HALF, toY: best.position.y + HALF };
  const d = player.direction;
  return clampEndpoint(player.mapId,
    player.position.x + HALF + (d === 2 ? rangePx : d === 1 ? -rangePx : 0),
    player.position.y + HALF + (d === 0 ? rangePx : d === 3 ? -rangePx : 0),
  );
}

on('customAction', ({ player, channel }) => {
  if (channel !== 'shoot') return;
  if (cooldowns[player.name]) return;

  const arrow = getEquippedArrow(player);
  if (!arrow) return;

  cooldowns[player.name] = cooldownTicks;

  const rangeTiles = arrow.rangeTiles || defaultRangeTiles;
  const tileSpeed  = arrow.tileSpeed  || defaultTileSpeed;
  const rangePx    = rangeTiles * TILE_SIZE;

  const fromX = player.position.x + HALF;
  const fromY = player.position.y + HALF;
  const { toX, toY } = aimEndpoint(player, rangePx);

  const dx = toX - fromX;
  const dy = toY - fromY;
  const totalDistPx = Math.sqrt(dx * dx + dy * dy);
  if (totalDistPx < 1) return;

  const speedPxPerTick = (tileSpeed * TILE_SIZE) / TICK_HZ;
  const duration = Math.max(50, Math.round(totalDistPx / (tileSpeed * TILE_SIZE) * 1000));

  projectiles.push({
    mapId: player.mapId,
    cx: fromX, cy: fromY,
    dirX: dx / totalDistPx,
    dirY: dy / totalDistPx,
    speedPxPerTick,
    remainingPx: totalDistPx,
    damage: arrow.damage,
    attacker: player,
  });

  sendMapEvent(player.mapId, 'projectile:fire', {
    fromX, fromY, toX, toY, duration,
    sprite: arrow.sprite,
    direction: player.direction,
  });
});

on('tick', () => {
  for (const name in cooldowns) {
    if (--cooldowns[name] <= 0) delete cooldowns[name];
  }

  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.cx += p.dirX * p.speedPxPerTick;
    p.cy += p.dirY * p.speedPxPerTick;
    p.remainingPx -= p.speedPxPerTick;

    const nearby = getNearbyNpcs(p.mapId, p.cx, p.cy, TILE_SIZE);
    let hit = false;
    for (const e of nearby) {
      if (!isEnemy(e)) continue;
      const ecx = e.position.x + HALF;
      const ecy = e.position.y + HALF;
      const relX = ecx - p.cx;
      const relY = ecy - p.cy;
      const along = relX * p.dirX + relY * p.dirY;
      const perp  = Math.abs(relX * p.dirY - relY * p.dirX);
      if (along < -p.speedPxPerTick) continue;
      if (perp > HALF) continue;
      dealDamage(e, p.damage, p.attacker);
      hit = true;
      break;
    }
    if (hit || p.remainingPx <= 0) projectiles.splice(i, 1);
  }
});
