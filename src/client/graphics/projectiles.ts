import { onServerEvent } from '../io/network/customEvents';

// Core projectile renderer. Any module/script can show a flying projectile by
// sending a `projectile:fire` event with centered pixel coords; the engine
// animates it from `from` to `to`. (Damage, if any, is applied server-side -
// the arrow is purely visual.)

interface Projectile {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  start: number;
  duration: number;
}

const active: Projectile[] = [];

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
  active.push({
    fromX: p.fromX,
    fromY: p.fromY,
    toX: p.toX,
    toY: p.toY,
    start: performance.now(),
    duration: typeof p.duration === 'number' ? p.duration : 250,
  });
});

export function renderProjectiles(ctx: CanvasRenderingContext2D): void {
  if (active.length === 0) return;
  const now = performance.now();

  for (let i = active.length - 1; i >= 0; i--) {
    const pr = active[i]!;
    const t = (now - pr.start) / pr.duration;
    if (t >= 1) {
      active.splice(i, 1);
      continue;
    }

    const x = pr.fromX + (pr.toX - pr.fromX) * t;
    const y = pr.fromY + (pr.toY - pr.fromY) * t;
    const angle = Math.atan2(pr.toY - pr.fromY, pr.toX - pr.fromX);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.strokeStyle = '#6b4423';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-9, 0); // shaft
    ctx.lineTo(9, 0);
    ctx.moveTo(9, 0); // arrowhead
    ctx.lineTo(4, -3);
    ctx.moveTo(9, 0);
    ctx.lineTo(4, 3);
    ctx.stroke();
    ctx.restore();
  }
}
