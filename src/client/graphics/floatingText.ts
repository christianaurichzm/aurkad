import { ObjectPool } from './objectPool';

interface FloatingText {
  active: boolean;
  text: string;
  x: number;
  y: number;
  getPos?: () => { x: number; y: number } | null;
  color: string;
  size: number;
  startTime: number;
  duration: number;
}

const pool = new ObjectPool<FloatingText>(64, () => ({
  active: false,
  text: '',
  x: 0,
  y: 0,
  color: '',
  size: 0,
  startTime: 0,
  duration: 0,
}));

export function spawnFloatingText(
  x: number,
  y: number,
  text: string,
  color = '#ffffff',
  duration = 1400,
  size = 16,
  getPos?: () => { x: number; y: number } | null,
): void {
  const ft = pool.acquire();
  if (!ft) return;
  ft.active = true;
  ft.x = x;
  ft.y = y;
  ft.text = text;
  ft.color = color;
  ft.size = size;
  ft.startTime = performance.now();
  ft.duration = duration;
  ft.getPos = getPos;
}

export function renderFloatingTexts(ctx: CanvasRenderingContext2D): void {
  const now = performance.now();
  pool.forEach((ft) => {
    const elapsed = now - ft.startTime;
    if (elapsed >= ft.duration) {
      ft.active = false;
      return;
    }
    const live = ft.getPos?.();
    const baseX = live ? live.x : ft.x;
    const baseY = live ? live.y : ft.y;
    const progress = elapsed / ft.duration;
    const alpha = progress < 0.6 ? 1 : (1 - progress) / 0.4;
    const offsetY = -progress * 50;

    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.font = `bold ${ft.size}px Arial`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.fillStyle = ft.color;
    ctx.strokeText(ft.text, baseX, baseY + offsetY);
    ctx.fillText(ft.text, baseX, baseY + offsetY);
    ctx.restore();
  });
}
