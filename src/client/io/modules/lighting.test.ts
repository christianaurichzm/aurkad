import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { loadClientModule, recordingContext } from '../../../test/clientModule';

// The shipped modules/lighting/client.js, loaded the way the browser loads
// it. The darkness is built on a recording offscreen canvas: it shows where
// the holes were punched, and the game canvas shows it was blitted.

let offscreen: ReturnType<typeof recordingContext>;

beforeEach(() => {
  offscreen = recordingContext(800, 600);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    offscreen.ctx,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

const player = {
  position: { x: 320, y: 320 },
} as unknown as Record<string, unknown>;

function draw(
  overrides: Record<string, unknown> = {},
  cam = { x: 0, y: 0 },
  payload?: unknown,
) {
  const mod = loadClientModule('lighting', {
    getPlayer: () => player,
    worldToScreen: (x: number, y: number) => ({ x: x - cam.x, y: y - cam.y }),
    ...overrides,
  });
  if (payload !== undefined) mod.handlers.get('lighting')!(payload);
  const rec = recordingContext(800, 600);
  mod.overlays.forEach((o) => o.fn(rec.ctx, cam));
  return rec;
}

describe('lighting overlay', () => {
  it('draws on the scene layer, so the hud stays lit', () => {
    const mod = loadClientModule('lighting');
    expect(mod.overlays).toHaveLength(1);
    expect(mod.overlays[0].order).toBe(50);
  });

  it('covers the view in screen space and blits the buffer over it', () => {
    const rec = draw({}, { x: 640, y: 480 });

    expect(rec.of('translate')[0].args).toEqual([640, 480]);
    expect(offscreen.of('fillRect')[0].args).toEqual([0, 0, 800, 600]);
    expect(rec.of('drawImage')).toHaveLength(1);
  });

  it('punches a hole where the player stands, in screen coordinates', () => {
    const rec = draw({}, { x: 100, y: 100 });

    // the darkness rect first, then one rect per light, on the light's own axes
    const [a, b, c, d, x, y] = offscreen.of('setTransform')[0].args as number[];
    [a, b, c, d].forEach((v, i) => expect(v).toBeCloseTo([1, 0, 0, 1][i], 6));
    expect(x).toBeCloseTo(320 + 32 - 100, 0); // centre of the tile
    expect(y).toBeCloseTo(320 + 32 - 100, 0);
    const hole = offscreen.of('fillRect')[1].args as number[];
    expect(hole[0]).toBe(-hole[2] / 2);
    // Nothing is painted onto the game canvas but the buffer: a light
    // reveals the world, it does not tint it.
    expect(rec.of('fillRect')).toHaveLength(0);
  });

  it('lights an ellipse on an isometric map, the ground circle as the screen sees it', () => {
    const cam = { x: 0, y: 0 };
    draw(
      {
        worldToScreen: (x: number, y: number) => ({
          x: (x - y) * 0.5 - cam.x,
          y: ((x + y) * 0.5) / 2 - cam.y,
        }),
      },
      cam,
    );

    const [a, b, c, d] = offscreen.of('setTransform')[0].args as number[];
    [a, b, c, d].forEach((v, i) =>
      expect(v).toBeCloseTo([0.5, 0.25, -0.5, 0.25][i], 6),
    );
  });

  it('draws nothing at all once a script sets ambient to zero', () => {
    const rec = draw({}, { x: 0, y: 0 }, { ambient: 0 });

    expect(rec.calls).toEqual([]);
    expect(offscreen.calls).toEqual([]);
  });

  it('takes the lights a script sends, on top of the carried one', () => {
    draw(
      {},
      { x: 0, y: 0 },
      {
        lights: [
          { x: 0, y: 0 },
          { x: 64, y: 64 },
        ],
      },
    );

    // darkness + two placed + the player's
    expect(offscreen.of('fillRect')).toHaveLength(4);
  });

  it('drops a light with no position rather than drawing at NaN', () => {
    draw({}, { x: 0, y: 0 }, { lights: [{ x: 10 }, { y: 10 }, null] });

    expect(offscreen.of('fillRect')).toHaveLength(2); // darkness + player only
  });

  it('lets a script put out the carried light', () => {
    draw({}, { x: 0, y: 0 }, { playerLight: false, lights: [] });

    expect(offscreen.of('fillRect')).toHaveLength(1); // the darkness alone
  });

  it('still darkens when there is no player yet', () => {
    const rec = draw({ getPlayer: () => undefined });

    expect(offscreen.of('fillRect')).toHaveLength(1);
    expect(rec.of('drawImage')).toHaveLength(1);
  });
});
