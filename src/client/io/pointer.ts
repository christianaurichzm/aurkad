import { GAME_WIDTH, GAME_HEIGHT, TILE_SIZE } from '../../shared/constants';
import {
  Key,
  type NpcBehavior,
  type Position,
  type RuntimeNpc,
} from '../../shared/types';
import { getGameState, getPlayer } from '../core/gameState';
import {
  getCamera,
  screenToWorld,
  spritePosition,
  worldToView,
} from '../graphics/camera';
import { mapEditorInitialized } from '../graphics/mapEditor';
import { pressKey, releaseKey } from './keyboard';
import { sendAction } from './network';

// Npcs a click talks to rather than hits.
const PEACEFUL: ReadonlySet<NpcBehavior> = new Set([
  'friendly',
  'shopkeeper',
  'guard',
]);

// A tap of a key from the pointer. Longer than a tick, so the server sees the
// press and the release in different ticks and the attack pose is drawn.
const TAP_MS = 120;

const tap = (key: Key) => {
  void pressKey(key);
  setTimeout(() => releaseKey(key), TAP_MS);
};

// The cell a click sent the player to, outlined on the ground for a moment
// so a tap is seen to have landed, and where.
const MARK_MS = 600;
let mark: { col: number; row: number; at: number } | null = null;

const cellOf = (x: number, y: number) => ({
  col: Math.floor(x / TILE_SIZE),
  row: Math.floor(y / TILE_SIZE),
});

// On an isometric map an npc stands upright over its cell, so a click on its
// body lands on the cells behind it; the sprite is what the player aimed at.
const npcUnder = (vx: number, vy: number) =>
  Object.values(getGameState()?.npcs ?? {}).find((npc) => {
    const at = spritePosition(npc.position.x, npc.position.y);
    return (
      vx >= at.x &&
      vx < at.x + npc.width &&
      vy >= at.y &&
      vy < at.y + npc.height
    );
  });

// Where the pointer rests on the world, in view pixels, and the npc the last
// click aimed at: the two a hostile's name is drawn for (renderEntityHuds).
let hover: { x: number; y: number } | null = null;
let clicked: string | undefined;

/**
 * The npcs the pointer has found, the one under it and the one last clicked:
 * by the same pick as a click, so the name shown is the npc a click would take.
 */
export const namedNpcs = (): ReadonlySet<string> => {
  const cam = getCamera();
  const under = hover && npcUnder(hover.x + cam.x, hover.y + cam.y);
  return new Set([under?.id, clicked].filter((id): id is string => !!id));
};

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, lo), hi);

// The cell of an npc's footprint closest to the player: one tile for most, the
// near side of a big one, which is the cell a swing from here would land on.
const nearestCellOf = (npc: RuntimeNpc, from: Position) =>
  cellOf(
    clamp(from.x, npc.position.x, npc.position.x + npc.width - TILE_SIZE) +
      TILE_SIZE / 2,
    clamp(from.y, npc.position.y, npc.position.y + npc.height - TILE_SIZE) +
      TILE_SIZE / 2,
  );

/**
 * A click or tap on the world walks there. On an npc right beside the player
 * it also acts on it, attack or F, the turn to face it riding on the same tick
 * (handleMoveTo); an npc further off is walked up to, and the next click acts.
 */
export const clickWorld = (sx: number, sy: number) => {
  const player = getPlayer();
  if (!player || mapEditorInitialized) return;
  const cam = getCamera();
  const npc = npcUnder(sx + cam.x, sy + cam.y);
  clicked = npc?.id;
  const world = screenToWorld(sx, sy);
  const { col, row } = npc
    ? nearestCellOf(npc, player.position)
    : cellOf(world.x, world.y);
  sendAction({ type: 'moveTo', col, row });
  mark = { col, row, at: performance.now() };

  if (!npc) return;
  const self = cellOf(
    player.position.x + TILE_SIZE / 2,
    player.position.y + TILE_SIZE / 2,
  );
  if (Math.abs(self.col - col) + Math.abs(self.row - row) !== 1) return;
  tap(PEACEFUL.has(npc.behavior) ? Key.f : Key.Control);
};

/**
 * The clicked cell's outline, drawn in view space under the actors: a square,
 * or a diamond on an isometric map, closing in on its centre as it fades.
 */
export const renderClickMark = (ctx: CanvasRenderingContext2D) => {
  if (!mark) return;
  const t = (performance.now() - mark.at) / MARK_MS;
  if (t >= 1) {
    mark = null;
    return;
  }
  const inset = (TILE_SIZE / 4) * t;
  const x0 = mark.col * TILE_SIZE + inset;
  const y0 = mark.row * TILE_SIZE + inset;
  const x1 = (mark.col + 1) * TILE_SIZE - inset;
  const y1 = (mark.row + 1) * TILE_SIZE - inset;
  ctx.save();
  ctx.globalAlpha = 1 - t;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const [x, y] of [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ] as const) {
    const p = worldToView(x, y);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
};

/** Clicks and the resting pointer on the world canvas, in logical pixels. */
export const handlePointer = () => {
  const canvas = document.getElementById(
    'foregroundCanvas',
  ) as HTMLCanvasElement | null;
  if (!canvas) return;
  const view = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * GAME_WIDTH) / rect.width,
      y: ((e.clientY - rect.top) * GAME_HEIGHT) / rect.height,
    };
  };
  canvas.addEventListener('click', (e) => {
    const { x, y } = view(e);
    clickWorld(x, y);
  });
  canvas.addEventListener('mousemove', (e) => (hover = view(e)));
  canvas.addEventListener('mouseleave', () => (hover = null));
};
