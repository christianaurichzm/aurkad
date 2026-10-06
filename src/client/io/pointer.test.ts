import { beforeEach, expect, it, vi } from 'vitest';
import { TILE_SIZE } from '../../shared/constants';
import { Key } from '../../shared/types';
import {
  clickWorld,
  handlePointer,
  namedNpcs,
  renderClickMark,
} from './pointer';
import { pressKey } from './keyboard';
import { sendAction } from './network';

const state = vi.hoisted(() => {
  const npcs: Record<string, unknown> = {};
  return { npcs, editorOpen: false };
});

vi.mock('./network', () => ({ sendAction: vi.fn() }));
vi.mock('./keyboard', () => ({ pressKey: vi.fn(), releaseKey: vi.fn() }));
vi.mock('../graphics/mapEditor', () => ({
  get mapEditorInitialized() {
    return state.editorOpen;
  },
}));
vi.mock('../core/gameState', () => ({
  getPlayer: () => ({ position: { x: 3 * 64, y: 3 * 64 } }),
  getGameState: () => ({ npcs: state.npcs }),
  getMapOrientation: () => undefined,
  getMapPixelSize: () => ({ w: 0, h: 0 }),
}));

const npcAt = (col: number, row: number, behavior: string, tiles = 1) => ({
  position: { x: col * TILE_SIZE, y: row * TILE_SIZE },
  width: tiles * TILE_SIZE,
  height: tiles * TILE_SIZE,
  behavior,
});
// The middle of a cell, with the camera at the origin of a flat map.
const click = (col: number, row: number) =>
  clickWorld((col + 0.5) * TILE_SIZE, (row + 0.5) * TILE_SIZE);

beforeEach(() => {
  vi.clearAllMocks();
  state.npcs = {};
  state.editorOpen = false;
});

it('walks to the clicked cell', () => {
  click(7, 2);
  expect(sendAction).toHaveBeenCalledWith({ type: 'moveTo', col: 7, row: 2 });
  expect(pressKey).not.toHaveBeenCalled();
});

it('attacks a hostile npc beside the player and talks to a friendly one', () => {
  state.npcs = { a: npcAt(2, 3, 'hostile'), b: npcAt(3, 4, 'friendly') };
  click(2, 3);
  click(3, 4);
  expect(vi.mocked(pressKey).mock.calls).toEqual([[Key.Control], [Key.f]]);
});

it('attacks a big npc clicked anywhere on its body, aiming at its near side', () => {
  // Cols 4-6, rows 1-3: the player at (3, 3) is beside its lower row.
  state.npcs = { a: npcAt(4, 1, 'hostile', 3) };
  click(6, 1);
  expect(sendAction).toHaveBeenCalledWith({ type: 'moveTo', col: 4, row: 3 });
  expect(pressKey).toHaveBeenCalledWith(Key.Control);
});

it('only walks up to an npc further off', () => {
  state.npcs = { a: npcAt(6, 3, 'hostile') };
  click(6, 3);
  expect(sendAction).toHaveBeenCalledWith({ type: 'moveTo', col: 6, row: 3 });
  expect(pressKey).not.toHaveBeenCalled();
});

it('leaves clicks to the map editor while it is open', () => {
  state.editorOpen = true;
  click(7, 2);
  expect(sendAction).not.toHaveBeenCalled();
});

it('outlines the clicked cell, and lets the outline fade', () => {
  const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  click(7, 2);

  renderClickMark(ctx);
  expect(vi.mocked(ctx.lineTo).mock.calls).toEqual([
    [7 * TILE_SIZE, 2 * TILE_SIZE],
    [8 * TILE_SIZE, 2 * TILE_SIZE],
    [8 * TILE_SIZE, 3 * TILE_SIZE],
    [7 * TILE_SIZE, 3 * TILE_SIZE],
  ]);

  now.mockReturnValue(1600);
  renderClickMark(ctx);
  expect(ctx.stroke).toHaveBeenCalledTimes(1);
  now.mockRestore();
});

it('maps a pointer through the logical view even with a double-sized buffer', () => {
  document.body.innerHTML =
    '<canvas id="foregroundCanvas" width="2560" height="1792"></canvas>';
  const canvas = document.querySelector('canvas')!;
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: -100, width: 1280, height: 896 }) as DOMRect;
  handlePointer();
  canvas.dispatchEvent(new MouseEvent('click', { clientX: 480, clientY: 60 }));
  expect(sendAction).toHaveBeenCalledWith({ type: 'moveTo', col: 7, row: 2 });
});

it('names the npc under the resting pointer and the one last clicked', () => {
  document.body.innerHTML =
    '<canvas id="foregroundCanvas" width="1280" height="896"></canvas>';
  const canvas = document.querySelector('canvas')!;
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 1280, height: 896 }) as DOMRect;
  handlePointer();
  state.npcs = {
    a: { id: 'a', ...npcAt(6, 3, 'aggressive') },
    b: { id: 'b', ...npcAt(9, 5, 'aggressive') },
  };
  click(6, 3);
  canvas.dispatchEvent(
    new MouseEvent('mousemove', {
      clientX: 9.5 * TILE_SIZE,
      clientY: 5.5 * TILE_SIZE,
    }),
  );
  expect([...namedNpcs()].sort()).toEqual(['a', 'b']);

  canvas.dispatchEvent(new MouseEvent('mouseleave'));
  click(1, 1);
  expect(namedNpcs().size).toBe(0);
});
