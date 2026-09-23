import { spellSheet } from '../io/assets';
import { entityAtlas, entityAtlasOffsets } from './atlas';
import { ObjectPool } from './objectPool';

const TILE = 32;
const DISPLAY = 64;
const DURATION = 350;
export const SPELL_FRAME_MS = 80;

interface SpellEffect {
  active: boolean;
  x: number;
  y: number;
  sprite: number;
  frames: number;
  start: number;
}

const pool = new ObjectPool<SpellEffect>(16, () => ({
  active: false,
  x: 0,
  y: 0,
  sprite: 0,
  frames: 1,
  start: 0,
}));

export function spawnSpellEffect(
  x: number,
  y: number,
  sprite: number,
  frames = 1,
): void {
  if (!spellSheet) return;
  const slot = pool.acquire();
  if (!slot) return;
  slot.active = true;
  slot.x = x;
  slot.y = y;
  slot.sprite = sprite;
  slot.frames = Math.max(1, frames);
  slot.start = performance.now();
}

export function renderSpellEffects(ctx: CanvasRenderingContext2D): void {
  if (!entityAtlas || pool.activeCount() === 0) return;
  const off = entityAtlasOffsets.spells;
  if (!off) return;
  const now = performance.now();
  const tilesPerRow = Math.max(1, Math.floor(off.width / TILE));

  pool.forEach((fx) => {
    const elapsed = now - fx.start;
    const animated = fx.frames > 1;
    if (elapsed >= (animated ? fx.frames * SPELL_FRAME_MS : DURATION)) {
      fx.active = false;
      return;
    }
    // A single sprite fades out; an animation plays its frames once, and the
    // sheet's own last frames do the fading.
    const sprite = animated
      ? fx.sprite + Math.floor(elapsed / SPELL_FRAME_MS)
      : fx.sprite;
    const sx = (sprite % tilesPerRow) * TILE;
    const sy = Math.floor(sprite / tilesPerRow) * TILE;
    ctx.save();
    ctx.globalAlpha = animated ? 1 : 1 - elapsed / DURATION;
    ctx.drawImage(
      entityAtlas!,
      off.x + sx,
      off.y + sy,
      TILE,
      TILE,
      fx.x,
      fx.y,
      DISPLAY,
      DISPLAY,
    );
    ctx.restore();
  });
}
