import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setStaticMap } from '../core/gameState';
import { setCamera } from './camera';
import {
  isometricFrames,
  tileAnimations,
  tileset,
  tilesetOpacity,
} from '../io/assets';
import type { Tile } from '../../shared/types';
import { renderGameMap, renderMapMask, standingMapObjects } from './mapRender';

const mocks = vi.hoisted(() => {
  const calls: { fn: string; args: unknown[] }[] = [];
  const record =
    (fn: string) =>
    (...args: unknown[]) => {
      calls.push({ fn, args });
    };
  return {
    calls,
    cam: { x: 0, y: 0 },
    canvas: {
      width: 128,
      height: 64,
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 128,
        height: 64,
      }),
    },
    ctx: {
      save: record('save'),
      restore: record('restore'),
      translate: record('translate'),
      transform: record('transform'),
      clearRect: record('clearRect'),
      drawImage: record('drawImage'),
      fillRect: record('fillRect'),
      fillText: record('fillText'),
      strokeText: record('strokeText'),
      fill: record('fill'),
      closePath: record('closePath'),
      beginPath: record('beginPath'),
      moveTo: record('moveTo'),
      lineTo: record('lineTo'),
      stroke: record('stroke'),
      strokeRect: record('strokeRect'),
    } as unknown as CanvasRenderingContext2D,
  };
});

vi.mock('./canvas', () => ({
  foregroundCanvas: mocks.canvas,
  foregroundCtx: mocks.ctx,
  maskCtx: mocks.ctx,
  fringeCtx: mocks.ctx,
  worldScale: 1,
  worldCanvasGeneration: 0,
  prepareWorldContext: vi.fn(),
}));

vi.mock('../io/assets', () => ({
  tileset: { width: 256, height: 256 },
  tilesetAlpha: { width: 256, height: 256 },
  tilesetOpacity: new Uint8Array(256 * 256),
  isometricFrames: {},
  isometricReach: 64,
  tileAnimations: {},
}));

beforeEach(() => {
  setStaticMap({ id: 'test', name: 'test', type: 'normal', tiles: [] });
  setCamera(mocks.cam);
});

/** A 4x4 map, of which the 128x64 canvas shows three columns and two rows. */
const mapOf = (tileIndex: number): Tile[][] =>
  Array.from({ length: 4 }, () =>
    Array.from({ length: 4 }, () => ({ tileIndex })),
  );

const counts = () => ({
  clears: mocks.calls.filter((c) => c.fn === 'clearRect').length,
  draws: mocks.calls.filter((c) => c.fn === 'drawImage').length,
});

describe('the map the game draws', () => {
  // The ground is painted onto a canvas of its own around the camera; the
  // tiles that land there are counted apart from the screen's draws.
  let painted = 0;
  beforeEach(() => {
    mocks.calls.length = 0;
    painted = 0;
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        constructor(
          public width: number,
          public height: number,
        ) {}
        getContext() {
          return {
            ...mocks.ctx,
            clearRect: () => {},
            drawImage: () => {
              painted++;
            },
          };
        }
      },
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('paints the ground around the camera once and copies the screen out of it', () => {
    const tiles = mapOf(1);
    renderGameMap(tiles);
    // The whole 4x4 map fits inside the viewport and its margin.
    expect(painted).toBe(16);
    expect(counts()).toEqual({ clears: 1, draws: 1 });

    setCamera({ x: 40, y: 20 });
    mocks.calls.length = 0;
    renderGameMap(tiles);

    expect(painted).toBe(16);
    expect(counts()).toEqual({ clears: 1, draws: 1 });
  });

  it('paints again for a new grid, or a camera past the margin', () => {
    const tiles = mapOf(1);
    renderGameMap(tiles);
    renderGameMap(mapOf(1));
    expect(painted).toBe(32);

    const wide = Array.from({ length: 4 }, () =>
      Array.from({ length: 40 }, () => ({ tileIndex: 1 })),
    );
    renderGameMap(wide);
    const before = painted;
    setCamera({ x: 1000, y: 0 });
    renderGameMap(wide);
    expect(painted).toBeGreaterThan(before);
  });

  it('uses explicit atlas frames on a flat map, keeping ground pixels opaque', () => {
    isometricFrames['0'] = {
      x: 128,
      y: 0,
      width: 128,
      height: 128,
      drawWidth: 64,
      drawHeight: 64,
      anchorX: 32,
      anchorY: 32,
    };
    try {
      renderGameMap([[{ tileIndex: 0 }]], true);
      expect(mocks.calls.find((call) => call.fn === 'drawImage')?.args).toEqual(
        [tileset, 128, 0, 128, 128, 0, 0, 64, 64],
      );
    } finally {
      delete isometricFrames['0'];
    }
  });

  it('draws an animated tile as its current frame, repainting when it turns', () => {
    tileAnimations['1'] = { frames: [5, 6], ms: 100 };
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    try {
      const sourceOf = () => {
        mocks.calls.length = 0;
        renderGameMap([[{ tileIndex: 1 }]], true);
        return mocks.calls.find((call) => call.fn === 'drawImage')?.args;
      };
      // A 256 px atlas holds four tiles a row: 5 and 6 are on the second.
      expect(sourceOf()?.slice(1, 3)).toEqual([64, 64]);
      now.mockReturnValue(100);
      expect(sourceOf()?.slice(1, 3)).toEqual([128, 64]);

      const tiles = mapOf(1);
      renderGameMap(tiles);
      now.mockReturnValue(150);
      renderGameMap(tiles);
      expect(painted).toBe(16);
      now.mockReturnValue(200);
      renderGameMap(tiles);
      expect(painted).toBe(32);

      // The same animation, far past the edge of the screen: it turns, and
      // nothing on screen has moved, so nothing is painted again.
      const offScreen = Array.from({ length: 4 }, () =>
        Array.from({ length: 40 }, () => ({ tileIndex: 2 })),
      );
      offScreen[0][39] = { tileIndex: 1 };
      renderGameMap(offScreen);
      const before = painted;
      now.mockReturnValue(300);
      renderGameMap(offScreen);
      expect(painted).toBe(before);
    } finally {
      now.mockRestore();
      delete tileAnimations['1'];
    }
  });

  it('draws a live grid straight onto the screen', () => {
    // The editor changes its grid in place, so a painted copy of it would go
    // stale with nothing to say so.
    renderGameMap(mapOf(1), true);

    // Two tiles: the loop walks one past the canvas edge and the draw culls
    // it, so a 128x64 viewport is 2x1 tiles, after one full-canvas clear.
    expect(painted).toBe(0);
    expect(counts()).toEqual({ clears: 1, draws: 2 });
  });

  it('leaves the ground alone when there is no map to draw', () => {
    // The editor's copy is empty until the admin route answers, and clearing
    // for it would blank the world until the camera moves.
    renderGameMap([]);

    expect(counts()).toEqual({ clears: 0, draws: 0 });
  });
});

describe('the props a map sorts with its actors', () => {
  it('fades a prop in front of the player that covers them, and no other', () => {
    const tiles = mapOf(0);
    for (const [col, row] of [
      [0, 0],
      [2, 2],
      [3, 3],
    ] as const)
      tiles[row][col].maskIndex = 5;
    setStaticMap({
      id: 'iso',
      name: 'iso',
      type: 'normal',
      orientation: 'isometric',
      tiles,
    });
    mocks.cam.x = -256;
    mocks.cam.y = -128;
    const saved: number[] = [];
    const drawnAt: number[] = [];
    const ctx = {
      canvas: { width: 512, height: 512 },
      globalAlpha: 1,
      save() {
        saved.push(this.globalAlpha);
      },
      restore() {
        this.globalAlpha = saved.pop() ?? 1;
      },
      drawImage() {
        drawnAt.push(this.globalAlpha);
      },
    };

    const alphaOf = Object.fromEntries(
      standingMapObjects(tiles, ctx as unknown as CanvasRenderingContext2D, {
        x: 64,
        y: 64,
      }).map((object) => {
        drawnAt.length = 0;
        object.draw();
        return [`${object.col},${object.row}`, drawnAt[0]];
      }),
    );

    // The player stands on (1,1): (0,0) is behind them, (3,3) in front but
    // below their feet, (2,2) in front and over their body.
    expect(alphaOf).toEqual({ '0,0': 1, '2,2': 0.45, '3,3': 1 });
    expect(ctx.globalAlpha).toBe(1);
  });

  it('fades a frame over the player only where it is solid, not for its shadow', () => {
    const tiles = mapOf(0);
    tiles[2][2].maskIndex = 1002;
    // A frame whose box takes in the whole view, drawn from the top left of a
    // 256 square sheet whose alpha the test sets.
    isometricFrames[1002] = {
      x: 0,
      y: 0,
      width: 256,
      height: 256,
      drawWidth: 512,
      drawHeight: 512,
      anchorX: 256,
      anchorY: 256,
    };
    setStaticMap({
      id: 'iso',
      name: 'iso',
      type: 'normal',
      orientation: 'isometric',
      tiles,
    });
    mocks.cam.x = -256;
    mocks.cam.y = -128;
    const drawnAt: number[] = [];
    const ctx = {
      canvas: { width: 512, height: 512 },
      globalAlpha: 1,
      save() {},
      restore() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      clip() {},
      drawImage() {
        drawnAt.push(this.globalAlpha);
      },
    };
    const alphaDrawn = (alpha: number) => {
      tilesetOpacity!.fill(alpha);
      drawnAt.length = 0;
      ctx.globalAlpha = 1;
      for (const object of standingMapObjects(
        tiles,
        ctx as unknown as CanvasRenderingContext2D,
        { x: 64, y: 64 },
      ))
        object.draw();
      return drawnAt[0];
    };
    try {
      expect(alphaDrawn(150)).toBe(1);
      expect(alphaDrawn(255)).toBe(0.45);
    } finally {
      delete isometricFrames[1002];
    }
  });

  it('clips a frame reaching past the lower edges of an isometric map, and no other', () => {
    const tiles = mapOf(0);
    tiles[1][1].maskIndex = 1003;
    tiles[1][3].maskIndex = 1003; // on the last column
    // A prop whose shadow runs most of a cell to the right of its foot.
    isometricFrames[1003] = {
      x: 0,
      y: 0,
      width: 64,
      height: 48,
      drawWidth: 64,
      drawHeight: 48,
      anchorX: 16,
      anchorY: 40,
    };
    setStaticMap({
      id: 'iso',
      name: 'iso',
      type: 'normal',
      orientation: 'isometric',
      tiles,
    });
    mocks.cam.x = -256;
    mocks.cam.y = -128;
    const clipped: string[] = [];
    let drawing = '';
    const ctx = {
      canvas: { width: 512, height: 512 },
      save() {},
      restore() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      clip() {
        clipped.push(drawing);
      },
      drawImage() {},
    } as unknown as CanvasRenderingContext2D;
    try {
      for (const object of standingMapObjects(tiles, ctx)) {
        drawing = `${object.col},${object.row}`;
        object.draw();
      }
      expect(clipped).toEqual(['3,1']);
    } finally {
      delete isometricFrames[1003];
    }
  });

  it('on an orthogonal map, sorts what rises off its cell and leaves what lies flat on the mask', () => {
    const tiles = mapOf(0);
    tiles[0][0].maskIndex = 7; // a cell of the sheet
    tiles[0][1].maskIndex = 1000; // a tree, drawn past the top of its cell
    tiles[1][0].maskIndex = 1001; // a path
    const frame = { x: 0, y: 0, width: 64, drawWidth: 64, anchorX: 32 };
    isometricFrames[1000] = {
      ...frame,
      height: 128,
      drawHeight: 128,
      anchorY: 96,
    };
    isometricFrames[1001] = {
      ...frame,
      height: 68,
      drawHeight: 68,
      anchorY: 34,
      piece: {
        name: 'path',
        layer: 'decal',
        at: [0, 0],
        variant: 0,
        blocks: false,
      },
    };
    setStaticMap({ id: 'o', name: 'o', type: 'normal', tiles });
    mocks.cam.x = 0;
    mocks.cam.y = 0;
    let draws = 0;
    const ctx = {
      canvas: { width: 512, height: 512 },
      save() {},
      restore() {},
      drawImage() {
        draws++;
      },
    } as unknown as CanvasRenderingContext2D;
    try {
      expect(standingMapObjects(tiles, ctx).map((o) => o.index)).toEqual([
        1000,
      ]);
      renderMapMask(tiles, ctx);
      expect(draws).toBe(2);
    } finally {
      delete isometricFrames[1000];
      delete isometricFrames[1001];
    }
  });
});
