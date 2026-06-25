import { spellSheet } from '../io/assets';
import { ObjectPool } from './objectPool';

const TILE = 32;
const DISPLAY = 64;
const DURATION = 350;

interface SpellEffect {
  active: boolean;
  x: number;
  y: number;
  sprite: number;
  start: number;
}

const pool = new ObjectPool<SpellEffect>(16, () => ({
  active: false,
  x: 0,
  y: 0,
  sprite: 0,
  start: 0,
}));

export function spawnSpellEffect(x: number, y: number, sprite: number): void {
  if (!spellSheet) return;
  const slot = pool.acquire();
  if (!slot) return;
  slot.x = x;
  slot.y = y;
  slot.sprite = sprite;
  slot.start = performance.now();
}

export function renderSpellEffects(ctx: CanvasRenderingContext2D): void {
  if (!spellSheet || pool.activeCount() === 0) return;
  const now = performance.now();
  const tilesPerRow = Math.max(1, Math.floor(spellSheet.width / TILE));

  pool.forEach((fx) => {
    const elapsed = now - fx.start;
    if (elapsed >= DURATION) {
      fx.active = false;
      return;
    }
    const sx = (fx.sprite % tilesPerRow) * TILE;
    const sy = Math.floor(fx.sprite / tilesPerRow) * TILE;
    ctx.save();
    ctx.globalAlpha = 1 - elapsed / DURATION;
    ctx.drawImage(spellSheet, sx, sy, TILE, TILE, fx.x, fx.y, DISPLAY, DISPLAY);
    ctx.restore();
  });
}
