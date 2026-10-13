import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setStaticMap } from '../core/gameState';
import { setCamera } from './camera';
import type { Tile } from '../../shared/types';
import {
  fillMap,
  getEditorTiles,
  initMapEditor,
  placePiece,
  readKit,
  renderEditorLayer,
  resetToOriginalMap,
  setEditorSaving,
  setEditorTiles,
  toggleBlocking,
  toggleKill,
  toggleMapEditor,
  toggleMask,
  undo,
} from './mapEditor';
import { tileAnimations } from '../io/assets';

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
  isometricFrames: {},
  isometricReach: 64,
  tileAnimations: {},
}));

beforeEach(() => {
  setStaticMap({ id: 'test', name: 'test', type: 'normal', tiles: [] });
  setCamera(mocks.cam);
});

vi.mock('../io/network', () => ({
  saveMap: vi.fn(),
  fetchNpcs: vi.fn(),
}));

/** A 4x4 map, of which the 128x64 canvas shows three columns and two rows. */
const mapOf = (tileIndex: number): Tile[][] =>
  Array.from({ length: 4 }, () =>
    Array.from({ length: 4 }, () => ({ tileIndex })),
  );

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
    initMapEditor();
  });

  const markerAt = () =>
    mocks.calls.find((c) => c.fn === 'fillText' && c.args[0] === 'B')?.args[1];

  it('moves a marker with the camera instead of with the screen', () => {
    const tiles = mapOf(1);
    tiles[0][1].blocked = true;
    setEditorTiles(tiles);
    mocks.calls.length = 0;

    renderEditorLayer();
    expect(markerAt()).toBe(1 * 64 + 3);

    mocks.calls.length = 0;
    mocks.cam.x = 64;
    renderEditorLayer();

    expect(markerAt()).toBe(1 * 64 - 64 + 3);
  });

  it("puts a tile's marks side by side, off the middle of the tile", () => {
    const tiles = mapOf(1);
    tiles[0][0].blocked = true;
    tiles[0][0].avoidNpc = true;
    setEditorTiles(tiles);
    mocks.calls.length = 0;

    renderEditorLayer();

    const at = (letter: string) =>
      mocks.calls.find((c) => c.fn === 'fillText' && c.args[0] === letter)
        ?.args;
    expect(at('B')?.slice(1)).toEqual([3, 3]);
    expect(at('A')?.slice(1)).toEqual([14, 3]);
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
    initMapEditor();
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

  // The load that follows a save replaces the buffer, so a stroke in between
  // would be drawn and never sent.
  it('takes no stroke while a save is out', () => {
    setEditorSaving(true);
    try {
      mouse('mousedown', 10);
      mouse('mouseup', 10);
    } finally {
      setEditorSaving(false);
    }

    expect(blocked(0)[0]).toBe(false);
  });

  it('forgets the history of the map it held before', () => {
    mouse('mousedown', 10);
    mouse('mouseup', 10);
    setEditorTiles(mapOf(2));

    undo();

    expect(getEditorTiles()[0]?.[0]).toEqual({ tileIndex: 2 });
  });

  // A snapshot's tile copy shares its triggers with the tile, so removing one
  // in place would reach the snapshot.
  it('brings a removed trigger back on undo, and on discard', () => {
    const tiles = mapOf(1);
    tiles[0][0].triggers = [{ action: 'kill' }];
    setEditorTiles(tiles);
    toggleBlocking();
    toggleKill();

    mouse('mousedown', 10);
    mouse('mouseup', 10);
    expect(getEditorTiles()[0]?.[0]?.triggers).toBeUndefined();

    undo();
    expect(getEditorTiles()[0]?.[0]?.triggers).toEqual([{ action: 'kill' }]);

    mouse('mousedown', 10);
    mouse('mouseup', 10);
    resetToOriginalMap();
    expect(getEditorTiles()[0]?.[0]?.triggers).toEqual([{ action: 'kill' }]);

    toggleKill();
    toggleBlocking();
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
    initMapEditor();
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

describe('isometric editing', () => {
  it('paints the diamond under the pointer and ignores clicks outside the map', () => {
    setStaticMap({
      id: 'iso',
      name: 'iso',
      type: 'normal',
      orientation: 'isometric',
      tiles: mapOf(0),
    });
    mocks.cam.x = -128;
    mocks.cam.y = 0;
    document.body.innerHTML =
      '<canvas id="tilesetCanvas"></canvas><canvas id="gridCanvas"></canvas><canvas id="foregroundCanvas"></canvas>';
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      mocks.ctx,
    );
    initMapEditor();
    setEditorTiles(mapOf(0));
    toggleBlocking();
    const canvas = document.getElementById('foregroundCanvas')!;
    const click = (clientX: number, clientY: number) => {
      canvas.dispatchEvent(new MouseEvent('mousedown', { clientX, clientY }));
      canvas.dispatchEvent(new MouseEvent('mouseup', { clientX, clientY }));
    };
    // Cell (1,0) center is (32,32) once projected, (160,32) with this camera.
    click(160, 32);
    click(0, 0);
    expect(getEditorTiles()[0][1].blocked).toBe(true);
    expect(
      getEditorTiles()
        .flat()
        .filter((t) => t.blocked),
    ).toHaveLength(1);
    toggleBlocking();
  });
});

describe('the palette', () => {
  beforeEach(() => {
    mocks.calls.length = 0;
    document.body.innerHTML =
      '<canvas id="tilesetCanvas"></canvas><canvas id="gridCanvas"></canvas>';
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      mocks.ctx,
    );
  });

  it('runs an animated tile in its cell and dims the frames it cycles through', () => {
    tileAnimations['1'] = { frames: [1, 5], ms: 100 };
    const now = vi.spyOn(performance, 'now').mockReturnValue(100);
    try {
      initMapEditor();
      const draws = mocks.calls.filter((c) => c.fn === 'drawImage');
      // A 256 px atlas holds four tiles a row: tile 1's cell is at (64, 0),
      // and frame 5, the one showing at 100 ms, comes from (64, 64).
      expect(
        draws.some(
          (c) =>
            c.args[1] === 64 &&
            c.args[2] === 64 &&
            c.args[5] === 64 &&
            c.args[6] === 0,
        ),
      ).toBe(true);
      expect(
        mocks.calls.filter((c) => c.fn === 'fillRect').map((c) => c.args),
      ).toEqual([[64, 64, 64, 64]]);
    } finally {
      toggleMapEditor(false);
      now.mockRestore();
      delete tileAnimations['1'];
    }
  });
});

describe('a kit atlas', () => {
  const frame = (piece: object) => ({
    x: 0,
    y: 0,
    width: 64,
    height: 32,
    drawWidth: 64,
    drawHeight: 32,
    anchorX: 32,
    anchorY: 16,
    piece: { layer: 'object', at: [0, 0], variant: 0, blocks: false, ...piece },
  });
  // A 2x1 ground in two variants, a grave with its mound, and a fence whose
  // frame ids are 10 plus the neighbours it joins.
  const frames = {
    1: frame({ name: 'grass', layer: 'ground', at: [0, 0] }),
    2: frame({ name: 'grass', layer: 'ground', at: [1, 0] }),
    3: frame({ name: 'grass', layer: 'ground', at: [0, 0], variant: 1 }),
    4: frame({ name: 'grass', layer: 'ground', at: [1, 0], variant: 1 }),
    5: frame({ name: 'grave', group: 'graves', blocks: true }),
    6: frame({ name: 'grave', group: 'graves', at: [0, 1] }),
    ...Object.fromEntries(
      Array.from({ length: 16 }, (_, mask) => [
        10 + mask,
        frame({ name: 'fence', group: 'walls', connect: mask, blocks: true }),
      ]),
    ),
    // Water, whose frame ids are 1000 plus the neighbours it joins,
    // corners and all.
    ...Object.fromEntries(
      Array.from({ length: 256 }, (_, mask) => [
        1000 + mask,
        frame({ name: 'pond', layer: 'decal', connect: mask, blocks: true }),
      ]),
    ),
  } as unknown as Parameters<typeof readKit>[0];
  const kit = readKit(frames);
  const piece = (name: string) => kit.pieces.find((p) => p.name === name)!;
  const first = () => 0;

  it('groups the frames into pieces in atlas order', () => {
    expect(kit.pieces.map((p) => [p.name, p.group, p.cols, p.rows])).toEqual([
      ['grass', '', 2, 1],
      ['grave', 'graves', 1, 2],
      ['fence', 'walls', 1, 1],
      ['pond', '', 1, 1],
    ]);
    expect(piece('grass').variants).toHaveLength(2);
  });

  it('repeats a ground with the map, whatever cell the stroke starts on', () => {
    const tiles = mapOf(0);
    for (let col = 0; col < 4; col++)
      placePiece(tiles, kit, piece('grass'), 1, col, first);
    expect(tiles[1].map((t) => t.tileIndex)).toEqual([1, 2, 1, 2]);
    placePiece(tiles, kit, piece('grass'), 1, 3, () => 1);
    expect(tiles[1][3].tileIndex).toBe(4);
  });

  it('lays every cell of an object, each blocking or not as its frame says', () => {
    const tiles = mapOf(0);
    placePiece(tiles, kit, piece('grave'), 0, 2, first);
    expect([tiles[0][2], tiles[1][2]]).toEqual([
      { tileIndex: 0, maskIndex: 5, blocked: true },
      { tileIndex: 0, maskIndex: 6, blocked: false },
    ]);
    placePiece(tiles, kit, null, 0, 2);
    expect(tiles[0][2]).toEqual({
      tileIndex: 0,
      maskIndex: undefined,
      blocked: false,
    });
  });

  it('joins a fence to the fence around it, and lets go when a post goes', () => {
    const tiles = mapOf(0);
    const fence = piece('fence');
    for (const [row, col] of [
      [1, 0],
      [1, 1],
      [1, 2],
      [0, 1],
    ])
      placePiece(tiles, kit, fence, row, col);
    const joined = () =>
      tiles.map((r) => r.map((t) => (t.maskIndex ?? 10) - 10));
    // Right; left, right and up; left; down.
    expect(joined()[1].slice(0, 3)).toEqual([2, 2 | 8 | 1, 8]);
    expect(joined()[0][1]).toBe(4);

    placePiece(tiles, kit, null, 1, 1);
    expect(joined()[1].slice(0, 3)).toEqual([0, 0, 0]);
    expect(joined()[0][1]).toBe(0);
  });

  it('tells a pond the corners it is filled to, and a fence only its sides', () => {
    const tiles = mapOf(0);
    // An L of water: the corner cell of the bend has no water across from it.
    for (const [row, col] of [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
      [2, 0],
    ])
      placePiece(tiles, kit, piece('pond'), row, col);
    const pond = (row: number, col: number) =>
      (tiles[row][col].maskIndex ?? 1000) - 1000;
    // Right, down and the corner between them: a block of water.
    expect(pond(0, 0)).toBe(2 | 4 | 32);
    // Up, left and down, with the corner up and left; the one down and left
    // is not water, the inside of the bend.
    expect(pond(1, 0)).toBe(1 | 2 | 4 | 16);
    expect(pond(1, 1)).toBe(1 | 8 | 128);

    const fence = piece('fence');
    for (const [row, col] of [
      [2, 2],
      [2, 3],
      [3, 2],
      [3, 3],
    ])
      placePiece(tiles, kit, fence, row, col);
    expect((tiles[2][2].maskIndex ?? 10) - 10).toBe(2 | 4);
  });
});
