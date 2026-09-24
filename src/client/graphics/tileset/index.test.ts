import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tile } from '../../../shared/types';
import {
  fillMap,
  getEditorTiles,
  initTilesetEditor,
  renderEditorLayer,
  renderGameMap,
  resetToOriginalMap,
  setEditorTiles,
  toggleBlocking,
  toggleMask,
} from './index';

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
      clearRect: record('clearRect'),
      drawImage: record('drawImage'),
      fillRect: record('fillRect'),
      fillText: record('fillText'),
      beginPath: record('beginPath'),
      moveTo: record('moveTo'),
      lineTo: record('lineTo'),
      stroke: record('stroke'),
      strokeRect: record('strokeRect'),
    } as unknown as CanvasRenderingContext2D,
  };
});

vi.mock('../canvas', () => ({
  foregroundCanvas: mocks.canvas,
  foregroundCtx: mocks.ctx,
  maskCtx: mocks.ctx,
  fringeCtx: mocks.ctx,
}));

vi.mock('../../io/assets', () => ({
  tileset: { width: 256, height: 256 },
  tilesetAlpha: { width: 256, height: 256 },
}));

vi.mock('../camera', () => ({ getCamera: () => mocks.cam }));

vi.mock('../../io/network', () => ({
  saveMap: vi.fn(),
  fetchNpcs: vi.fn(),
}));

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
  beforeEach(() => {
    mocks.calls.length = 0;
  });

  it('clears once and draws only what the viewport covers', () => {
    renderGameMap(mapOf(1));

    // Two tiles: the loop walks one past the canvas edge and the draw culls
    // it, so a 128x64 viewport is 2x1 tiles, after one full-canvas clear.
    expect(counts()).toEqual({ clears: 1, draws: 2 });
  });

  it('leaves the ground alone when there is no map to draw', () => {
    // The editor's copy is empty until the admin route answers, and clearing
    // for it would blank the world until the camera moves.
    renderGameMap([]);

    expect(counts()).toEqual({ clears: 0, draws: 0 });
  });

  it('leaves the editor copy alone', () => {
    // The editor loads its own copy over the admin route: the game's tiles
    // are `TilePublic`, stripped of every trigger, warp and door, and an
    // editor seeded from them would save a map with the rules erased.
    setEditorTiles(mapOf(9));
    const loaded = getEditorTiles();

    renderGameMap(mapOf(1));

    expect(getEditorTiles()).toBe(loaded);
    expect(getEditorTiles()[0]?.[0]?.tileIndex).toBe(9);
  });
});

describe('the map the editor holds', () => {
  beforeEach(() => {
    mocks.calls.length = 0;
  });

  it('keeps what the admin route sent, rules and all', () => {
    setEditorTiles([
      [
        {
          tileIndex: 2,
          triggers: [{ action: 'script', scriptId: 'reward' }],
          warp: { to: 'cave', position: { x: 0, y: 0 } },
        },
      ],
    ]);

    const tile = getEditorTiles()[0]?.[0];
    expect(tile?.triggers?.[0]).toMatchObject({ scriptId: 'reward' });
    expect(tile?.warp?.to).toBe('cave');
  });

  it('takes a copy, so editing does not write through to the fetched map', () => {
    const fetched = mapOf(6);
    setEditorTiles(fetched);

    getEditorTiles()[0][0].tileIndex = 7;

    expect(fetched[0]?.[0]?.tileIndex).toBe(6);
  });
});

describe('the layer the editor draws over the map', () => {
  beforeEach(() => {
    mocks.calls.length = 0;
    mocks.cam.x = 0;
    mocks.cam.y = 0;
    document.body.innerHTML =
      '<canvas id="tilesetCanvas"></canvas><canvas id="gridCanvas"></canvas>';
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      mocks.ctx,
    );
    initTilesetEditor();
  });

  const markerAt = () =>
    mocks.calls.find((c) => c.fn === 'fillText' && c.args[0] === 'B')?.args[1];

  it('moves a marker with the camera instead of with the screen', () => {
    const tiles = mapOf(1);
    tiles[0][1].blocked = true;
    setEditorTiles(tiles);
    mocks.calls.length = 0;

    renderEditorLayer();
    expect(markerAt()).toBe(1 * 64 + 20);

    mocks.calls.length = 0;
    mocks.cam.x = 64;
    renderEditorLayer();

    expect(markerAt()).toBe(1 * 64 - 64 + 20);
  });

  it('keeps the fetched map as the one a discard restores', () => {
    setEditorTiles(mapOf(1));

    fillMap();

    resetToOriginalMap();
    expect(getEditorTiles()[0]?.[0]?.tileIndex).toBe(1);
  });

  it('walks the viewport, not the map', () => {
    const tiles = mapOf(1);
    tiles.forEach((row) => row.forEach((tile) => (tile.blocked = true)));
    setEditorTiles(tiles);
    mocks.calls.length = 0;

    renderEditorLayer();

    // A 128x64 viewport over a 4x4 map: the pass reaches three columns and two
    // rows (one past each edge), and the draw culls the ones off-canvas.
    const markers = mocks.calls.filter(
      (c) => c.fn === 'fillText' && c.args[0] === 'B',
    );
    expect(markers).toHaveLength(2);
  });
});

describe('a drag in a toggle mode', () => {
  beforeEach(() => {
    mocks.cam.x = 0;
    mocks.cam.y = 0;
    document.body.innerHTML =
      '<canvas id="tilesetCanvas"></canvas><canvas id="gridCanvas"></canvas>' +
      '<canvas id="foregroundCanvas"></canvas>';
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      mocks.ctx,
    );
    initTilesetEditor();
    setEditorTiles(mapOf(1));
    toggleBlocking();
  });

  afterEach(() => {
    toggleBlocking();
  });

  const mouse = (type: string, clientX: number, clientY = 10) =>
    document
      .getElementById('foregroundCanvas')!
      .dispatchEvent(new MouseEvent(type, { clientX, clientY }));

  const blocked = (row: number) =>
    getEditorTiles()[row].map((tile) => Boolean(tile.blocked));

  it('blocks every tile it crosses, however many moves land in each', () => {
    mouse('mousedown', 10);
    // Two events land in every tile, so a toggle per event would leave the
    // whole strip back where it started.
    for (const x of [20, 70, 80, 130, 140, 200, 210]) mouse('mousemove', x);
    mouse('mouseup', 210);

    expect(blocked(0)).toEqual([true, true, true, true]);
    expect(blocked(1)).toEqual([false, false, false, false]);
  });

  it('still toggles a tile back on a second click', () => {
    mouse('mousedown', 10);
    mouse('mouseup', 10);
    mouse('mousedown', 10);
    mouse('mouseup', 10);

    expect(blocked(0)[0]).toBe(false);
  });
});

describe('a mask placed from a selection of several tiles', () => {
  beforeEach(() => {
    mocks.cam.x = 0;
    mocks.cam.y = 0;
    document.body.innerHTML =
      '<canvas id="tilesetCanvas"></canvas><canvas id="gridCanvas"></canvas>' +
      '<canvas id="foregroundCanvas"></canvas>';
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      mocks.ctx,
    );
    initTilesetEditor();
    setEditorTiles(mapOf(1));
    toggleMask();
  });

  afterEach(() => {
    toggleMask();
  });

  const on = (id: string, type: string, clientX: number, clientY: number) =>
    document
      .getElementById(id)!
      .dispatchEvent(new MouseEvent(type, { clientX, clientY }));

  const masks = () =>
    getEditorTiles().map((row) => row.map((tile) => tile.maskIndex));

  it('lays down the whole selection, and a second click takes it back off', () => {
    const tilesetCanvas = document.getElementById('tilesetCanvas')!;
    tilesetCanvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 256, height: 256 }) as DOMRect;
    // Tileset cells (1,1) to (2,2) of a 4-wide sheet: indices 5, 6, 9 and 10.
    on('tilesetCanvas', 'mousedown', 70, 70);
    on('tilesetCanvas', 'mousemove', 130, 130);
    on('tilesetCanvas', 'mouseup', 130, 130);

    on('foregroundCanvas', 'mousedown', 10, 10);
    on('foregroundCanvas', 'mouseup', 10, 10);

    const u = undefined;
    expect(masks()).toEqual([
      [5, 6, u, u],
      [9, 10, u, u],
      [u, u, u, u],
      [u, u, u, u],
    ]);

    on('foregroundCanvas', 'mousedown', 10, 10);
    on('foregroundCanvas', 'mouseup', 10, 10);

    expect(
      masks()
        .flat()
        .every((index) => index === undefined),
    ).toBe(true);
  });
});
