import { ObjectPool } from './objectPool';

interface FloatingText {
  active: boolean;
  text: string;
  x: number;
  y: number;
  getPos?: () => { x: number; y: number } | null;
  color: string;
  font: string;
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
  font: '',
  size: 0,
  startTime: 0,
  duration: 0,
}));

/** A theme token (styles.css), resolved: the canvas cannot read var(). */
export function themeToken(name: string, fallback: string): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
    fallback
  );
}

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
  ft.font = themeToken('--font-world', 'sans-serif');
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
    // A beat larger as it appears, so a number lands like the hit it stands
    // for instead of fading in like a label.
    const pop = 1 + 0.35 * Math.max(0, 1 - elapsed / 140);

    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.font = `bold ${Math.round(ft.size * pop)}px ${ft.font}`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.fillStyle = ft.color;
    ctx.strokeText(ft.text, baseX, baseY + offsetY);
    ctx.fillText(ft.text, baseX, baseY + offsetY);
    ctx.restore();
  });
}
