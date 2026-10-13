import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadClientModule, recordingContext } from '../../../test/clientModule';

// The shipped modules/minimap/client.js, loaded the way the browser loads
// it. jsdom has no 2d context and the minimap caches tiles offscreen, so a
// recorder stands in, which also lets the test check the cache.

let layer: ReturnType<typeof recordingContext>;

beforeEach(() => {
  layer = recordingContext();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    layer.ctx,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

const TILE = 64;

function mapOf(cols: number, rows: number, blocked: [number, number][] = []) {
  const tiles = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ tileIndex: 0, blocked: false })),
  );
  for (const [col, row] of blocked) tiles[row][col].blocked = true;
  return {
    id: 'map1',
    name: 'Map',
    type: 'normal',
    tiles,
    players: {},
    npcs: {},
    droppedItems: [],
  };
}

const npcAt = (id: string, col: number, row: number, health = 10) => ({
  id,
  health,
  position: { x: col * TILE, y: row * TILE },
});

function draw(
  state: unknown,
  player: unknown = undefined,
  cam = { x: 0, y: 0 },
  canvas: [number, number] = [800, 600],
) {
  const mod = loadClientModule('minimap', {
    getGameState: () => state,
    getPlayer: () => player,
    getVisibleView: () => ({
      x: 0,
      y: 0,
      width: canvas[0],
      height: canvas[1],
      scale: 1,
    }),
    screenToWorld: (x: number, y: number) => ({ x: x + cam.x, y: y + cam.y }),
  });
  const rec = recordingContext(canvas[0], canvas[1]);
  mod.overlays.forEach((o) => o.fn(rec.ctx, cam));
  return { rec, mod };
}

describe('minimap overlay', () => {
  it('pins itself and the viewport polygon to the visible crop of a scaled canvas', () => {
    const mod = loadClientModule('minimap', {
      getGameState: () => mapOf(60, 40),
      getVisibleView: () => ({
        x: 0,
        y: 100,
        width: 1280,
        height: 700,
        scale: 1,
      }),
    });
    const rec = recordingContext(2560, 1792);
    mod.overlays[0].fn(rec.ctx, { x: 0, y: 0 });
    expect(rec.of('drawImage')[0].args.slice(1, 3)).toEqual([1112, 108]);
    expect(rec.of('moveTo')[0].args).toEqual([
      1112,
      108 + (100 / 64) * (160 / 60),
    ]);
  });

  it('keeps its size on screen when the world is drawn larger than its view', () => {
    const mod = loadClientModule('minimap', {
      getGameState: () => mapOf(60, 40),
      getVisibleView: () => ({
        x: 0,
        y: 0,
        width: 1280,
        height: 896,
        scale: 2,
      }),
    });
    const rec = recordingContext();
    mod.overlays[0].fn(rec.ctx, { x: 0, y: 0 });
    // 80 view px wide is 160 on screen; the 8 px margin is 4.
    const [x, y, w, h] = rec.of('drawImage')[0].args.slice(1, 5) as number[];
    expect([x, y, w]).toEqual([1196, 4, 80]);
    expect(h).toBeCloseTo((40 * 80) / 60);
  });

  it('tells the quest tracker how much of the corner it takes', () => {
    document.documentElement.style.removeProperty('--hud-top-right');
    draw(mapOf(60, 40));
    // The margin, the map's 160 * 40 / 60 and the frame's 2 px below it.
    expect(
      document.documentElement.style.getPropertyValue('--hud-top-right'),
    ).toBe(`${Math.ceil(8 + (160 * 40) / 60 + 2)}px`);
  });

  it('draws on the hud layer, so a night tint cannot dim it', () => {
    const { mod } = draw(mapOf(20, 14));

    expect(mod.overlays).toHaveLength(1);
    expect(mod.overlays[0].order).toBe(100);
  });

  it('draws nothing before the first world update', () => {
    const { rec } = draw(null);

    expect(rec.calls).toHaveLength(0);
  });

  it('renders the tiles once into an image it then scales', () => {
    const { rec } = draw(mapOf(20, 14));

    // One drawImage per frame, not a fillRect per tile: tiles are painted
    // offscreen when the map changes, not on every frame.
    expect(rec.of('drawImage')).toHaveLength(1);
    expect(layer.of('fillRect')).toHaveLength(20 * 14);
  });

  it('reuses the cached tile layer across frames of the same map', () => {
    const state = mapOf(20, 14);
    const mod = loadClientModule('minimap', {
      getGameState: () => state,
      getPlayer: () => undefined,
    });
    const rec = recordingContext();

    mod.overlays[0].fn(rec.ctx, { x: 0, y: 0 });
    const afterFirst = layer.of('fillRect').length;
    mod.overlays[0].fn(rec.ctx, { x: 0, y: 0 });

    expect(layer.of('fillRect')).toHaveLength(afterFirst);
  });

  it('repaints only the rows of tiles that changed', () => {
    let state = mapOf(20, 14);
    const mod = loadClientModule('minimap', {
      getGameState: () => state,
      getPlayer: () => undefined,
    });
    const rec = recordingContext();
    mod.overlays[0].fn(rec.ctx, { x: 0, y: 0 });
    const afterFirst = layer.of('fillRect').length;

    // How the client applies a chunk, or a tile a script changed: a new grid
    // sharing every row it did not touch.
    const tiles = state.tiles.slice();
    tiles[3] = tiles[3].map((t, col) =>
      col === 7 ? { ...t, blocked: true } : t,
    );
    state = { ...state, tiles };
    mod.overlays[0].fn(rec.ctx, { x: 0, y: 0 });

    expect(layer.of('fillRect')).toHaveLength(afterFirst + 20);
  });

  it('marks living npcs and the player, and skips the dead', () => {
    const state = mapOf(20, 14);
    state.npcs = {
      alive: npcAt('alive', 3, 3),
      dead: npcAt('dead', 4, 4, 0),
    };
    const me = { id: 'me', position: { x: 5 * TILE, y: 5 * TILE } };

    const { rec } = draw(state, me);

    // The frame, the living npc and the player; the corpse draws nothing.
    expect(rec.of('fillRect')).toHaveLength(3);
  });

  it('does not draw the player twice when it is also in the map players', () => {
    const state = mapOf(20, 14);
    const me = { id: 'me', position: { x: 5 * TILE, y: 5 * TILE } };
    state.players = { me };

    const { rec } = draw(state, me);

    expect(rec.of('fillRect')).toHaveLength(2); // frame + self, not self twice
  });

  // On a map that fits one screen the rectangle would trace the whole
  // minimap, a border over a border.
  it('skips the viewport rectangle when the map fits on one screen', () => {
    const { rec } = draw(mapOf(10, 8), undefined, { x: 0, y: 0 }, [800, 600]);

    expect(rec.of('strokeRect')).toHaveLength(0);
  });

  it('draws the viewport rectangle when the map is bigger than the screen', () => {
    const { rec } = draw(mapOf(60, 40), undefined, { x: 0, y: 0 }, [800, 600]);

    expect(rec.of('stroke')).toHaveLength(1);
    expect(rec.of('lineTo')).toHaveLength(3);
  });

  it('sits in screen space, not at a place in the world', () => {
    const { rec } = draw(mapOf(20, 14), undefined, { x: 320, y: 192 });

    expect(rec.of('translate')[0].args).toEqual([320, 192]);
  });
});
