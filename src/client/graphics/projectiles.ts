import { arrowSheet } from '../io/assets';
import { onServerEvent } from '../io/network/customEvents';
import { ObjectPool } from './objectPool';

const ARROW_TILE = 32;

// Core projectile renderer. Any module/script can show a flying projectile by
// sending a `projectile:fire` event with centered pixel coords; the engine
// animates it from `from` to `to`. (Damage, if any, is applied server-side -
// the arrow is purely visual.)

interface Projectile {
  active: boolean;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  start: number;
  duration: number;
}

const pool = new ObjectPool<Projectile>(32, () => ({
  active: false,
  fromX: 0,
  fromY: 0,
  toX: 0,
  toY: 0,
  start: 0,
  duration: 0,
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
    const angle = Math.atan2(pr.toY - pr.fromY, pr.toX - pr.fromX);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    if (arrowSheet) {
      const half = ARROW_TILE / 2;
      ctx.drawImage(
        arrowSheet,
        0,
        0,
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
