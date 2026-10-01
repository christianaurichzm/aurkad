import { worldToView } from './camera';
import { entityAtlas, entityAtlasOffsets } from './atlas';
import { onServerEvent } from '../io/network/customEvents';
import { ObjectPool } from './objectPool';

const ARROW_TILE = 32;

// Each sheet row holds 4 tiles: base+0=↓, base+1=↑, base+2=→, base+3=←.
// Direction enum: 0=DOWN, 1=LEFT, 2=RIGHT, 3=UP.
const DIR_TO_SPRITE_OFFSET = [0, 3, 2, 1]; // [DOWN, LEFT, RIGHT, UP]

interface Projectile {
  active: boolean;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  start: number;
  duration: number;
  sprite: number;
  direction: number;
}

const pool = new ObjectPool<Projectile>(32, () => ({
  active: false,
  fromX: 0,
  fromY: 0,
  toX: 0,
  toY: 0,
  start: 0,
  duration: 0,
  sprite: 0,
  direction: 0,
}));

onServerEvent('projectile:fire', (payload) => {
  const p = payload as Partial<Projectile>;
  if (
    typeof p?.fromX !== 'number' ||
    typeof p.fromY !== 'number' ||
    typeof p.toX !== 'number' ||
    typeof p.toY !== 'number'
  ) {
    return;
  }
  const pr = pool.acquire();
  if (!pr) return;
  pr.active = true;
  pr.fromX = p.fromX;
  pr.fromY = p.fromY;
  pr.toX = p.toX;
  pr.toY = p.toY;
  pr.start = performance.now();
  pr.duration = typeof p.duration === 'number' ? p.duration : 250;
  pr.sprite = typeof p.sprite === 'number' ? p.sprite : 0;
  pr.direction = typeof p.direction === 'number' ? p.direction : 0;
});

export function renderProjectiles(ctx: CanvasRenderingContext2D): void {
  if (pool.activeCount() === 0) return;
  const now = performance.now();

  pool.forEach((pr) => {
    const t = (now - pr.start) / pr.duration;
    if (t >= 1) {
      pr.active = false;
      return;
    }

    const x = pr.fromX + (pr.toX - pr.fromX) * t;
    const y = pr.fromY + (pr.toY - pr.fromY) * t;

    const offset = DIR_TO_SPRITE_OFFSET[pr.direction] ?? 0;
    const actualSprite = pr.sprite + offset;

    const off = entityAtlasOffsets.arrows;
    ctx.save();
    const at = worldToView(x, y);
    const from = worldToView(pr.fromX, pr.fromY);
    const to = worldToView(pr.toX, pr.toY);
    ctx.translate(at.x, at.y);
    ctx.rotate(
      Math.atan2(to.y - from.y, to.x - from.x) -
        Math.atan2(pr.toY - pr.fromY, pr.toX - pr.fromX),
    );
    if (entityAtlas && off) {
      const half = ARROW_TILE / 2;
      const tilesPerRow = Math.max(1, Math.floor(off.width / ARROW_TILE));
      const sx = (actualSprite % tilesPerRow) * ARROW_TILE;
      const sy = Math.floor(actualSprite / tilesPerRow) * ARROW_TILE;
      ctx.drawImage(
        entityAtlas,
        off.x + sx,
        off.y + sy,
        ARROW_TILE,
        ARROW_TILE,
        -half,
        -half,
        ARROW_TILE,
        ARROW_TILE,
      );
    } else {
      ctx.strokeStyle = '#6b4423';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-9, 0);
      ctx.lineTo(9, 0);
      ctx.moveTo(9, 0);
      ctx.lineTo(4, -3);
      ctx.moveTo(9, 0);
      ctx.lineTo(4, 3);
      ctx.stroke();
    }
    ctx.restore();
  });
}
