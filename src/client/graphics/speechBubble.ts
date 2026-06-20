const BUBBLE_DURATION = 4000;
const MAX_TEXT_LEN = 42;

const bubbles = new Map<string, { text: string; startTime: number }>();

export function setPlayerSpeech(id: string, text: string) {
  const truncated =
    text.length > MAX_TEXT_LEN ? text.slice(0, MAX_TEXT_LEN - 3) + '...' : text;
  bubbles.set(id, { text: truncated, startTime: performance.now() });
}

function getActiveSpeech(id: string): string | null {
  const b = bubbles.get(id);
  if (!b) return null;
  if (performance.now() - b.startTime >= BUBBLE_DURATION) {
    bubbles.delete(id);
    return null;
  }
  return b.text;
}

export function renderSpeechBubble(
  ctx: CanvasRenderingContext2D,
  id: string,
  cx: number,
  ty: number,
) {
  const text = getActiveSpeech(id);
  if (!text) return;

  const elapsed = performance.now() - bubbles.get(id)!.startTime;
  const progress = elapsed / BUBBLE_DURATION;
  const alpha = progress > 0.75 ? (1 - progress) / 0.25 : 1;

  ctx.save();
  ctx.globalAlpha = Math.max(0, alpha);
  ctx.font = '12px Arial';

  const textW = Math.min(ctx.measureText(text).width, 180);
  const padX = 10;
  const padY = 5;
  const bw = textW + padX * 2;
  const bh = 22;
  const bx = cx - bw / 2;
  const by = ty - bh - 28;
  const r = 6;

  // bubble body
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, r);
  ctx.fill();
  ctx.stroke();

  // tail
  ctx.beginPath();
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.moveTo(cx - 5, by + bh - 1);
  ctx.lineTo(cx + 5, by + bh - 1);
  ctx.lineTo(cx, by + bh + 6);
  ctx.closePath();
  ctx.fill();

  // text
  ctx.fillStyle = '#222';
  ctx.textAlign = 'center';
  ctx.fillText(text, cx, by + bh - padY);

  ctx.restore();
}
