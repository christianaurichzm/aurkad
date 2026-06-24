interface FloatingText {
  text: string;
  x: number;
  y: number;
  getPos?: () => { x: number; y: number } | null;
  color: string;
  size: number;
  startTime: number;
  duration: number;
}

const active: FloatingText[] = [];

export function spawnFloatingText(
  x: number,
  y: number,
  text: string,
  color = '#ffffff',
  duration = 1400,
  size = 16,
  getPos?: () => { x: number; y: number } | null,
) {
  active.push({
    text,
    x,
    y,
    getPos,
    color,
    size,
    startTime: performance.now(),
    duration,
  });
}

export function renderFloatingTexts(ctx: CanvasRenderingContext2D) {
  const now = performance.now();
  for (let i = active.length - 1; i >= 0; i--) {
    const ft = active[i];
    const elapsed = now - ft.startTime;
    if (elapsed >= ft.duration) {
      active.splice(i, 1);
      continue;
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
  }
}
