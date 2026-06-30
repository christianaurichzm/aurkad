import { attackEffectSheet } from '../io/assets';
import { entityAtlas, entityAtlasOffsets } from './atlas';
import { Direction } from '../../shared/types';
import { TILE_SIZE } from '../../shared/constants';

const FRAME_W = 64;
const FRAME_H = 64;
const FRAMES_PER_ROW = 6;
const FRAME_COUNT = 6;
const FRAME_DURATION = 70;

interface AttackEffect {
  x: number;
  y: number;
  startTime: number;
}

const active: AttackEffect[] = [];

export function spawnAttackEffect(x: number, y: number, dir: Direction): void {
  if (!attackEffectSheet) return;
  const offset = TILE_SIZE;
  let ex = x;
  let ey = y;
  if (dir === Direction.Up) ey -= offset;
  else if (dir === Direction.Down) ey += offset;
  else if (dir === Direction.Left) ex -= offset;
  else if (dir === Direction.Right) ex += offset;
  active.push({ x: ex, y: ey, startTime: performance.now() });
}

export function renderAttackEffects(ctx: CanvasRenderingContext2D): void {
  if (!entityAtlas || active.length === 0) return;
  const off = entityAtlasOffsets.attackEffect!;
  const now = performance.now();
  const totalDuration = FRAME_COUNT * FRAME_DURATION;

  for (let i = active.length - 1; i >= 0; i--) {
    const eff = active[i]!;
    const elapsed = now - eff.startTime;
    if (elapsed >= totalDuration) {
      active.splice(i, 1);
      continue;
    }
    const frame = Math.min(
      FRAME_COUNT - 1,
      Math.floor(elapsed / FRAME_DURATION),
    );
    const sx = (frame % FRAMES_PER_ROW) * FRAME_W;
    const sy = Math.floor(frame / FRAMES_PER_ROW) * FRAME_H;
    ctx.drawImage(
      entityAtlas,
      off.x + sx,
      off.y + sy,
      FRAME_W,
      FRAME_H,
      eff.x,
      eff.y,
      FRAME_W,
      FRAME_H,
    );
  }
}
