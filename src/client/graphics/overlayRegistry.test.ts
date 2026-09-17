import { describe, it, expect, vi, afterEach } from 'vitest';
import { OverlayLayer, registerOverlay, runOverlays } from './overlayRegistry';

const ctx = {} as CanvasRenderingContext2D;
const cam = { x: 0, y: 0 };

let cleanups: (() => void)[] = [];
const add = (fn: Parameters<typeof registerOverlay>[0], order?: number) => {
  cleanups.push(registerOverlay(fn, order));
};

afterEach(() => {
  cleanups.forEach((c) => c());
  cleanups = [];
  vi.restoreAllMocks();
});

describe('overlay order', () => {
  // A day/night tint on the world layer must not paint over the minimap,
  // whatever order the modules loaded in.
  it('draws hud over world however they registered', () => {
    const order: string[] = [];
    add(() => order.push('hud'), OverlayLayer.hud);
    add(() => order.push('world'), OverlayLayer.world);

    runOverlays(ctx, cam);

    expect(order).toEqual(['world', 'hud']);
  });

  it('keeps registration order within one layer', () => {
    const order: string[] = [];
    add(() => order.push('first'), OverlayLayer.hud);
    add(() => order.push('second'), OverlayLayer.hud);
    add(() => order.push('third'), OverlayLayer.hud);

    runOverlays(ctx, cam);

    expect(order).toEqual(['first', 'second', 'third']);
  });

  // The hud draws on the canvas above the fringe, so the two layers run in
  // separate passes and each pass must take only its own.
  it('runs one layer at a time when asked for one', () => {
    const order: string[] = [];
    add(() => order.push('world'));
    add(() => order.push('hud'), OverlayLayer.hud);

    runOverlays(ctx, cam, OverlayLayer.hud);
    expect(order).toEqual(['hud']);

    runOverlays(ctx, cam, OverlayLayer.world);
    expect(order).toEqual(['hud', 'world']);
  });

  it('defaults to the world layer', () => {
    const order: string[] = [];
    add(() => order.push('default'));
    add(() => order.push('hud'), OverlayLayer.hud);

    runOverlays(ctx, cam);

    expect(order).toEqual(['default', 'hud']);
  });
});

describe('registration lifecycle', () => {
  it('stops calling an overlay once it unregisters', () => {
    const fn = vi.fn();
    const stop = registerOverlay(fn);

    runOverlays(ctx, cam);
    stop();
    runOverlays(ctx, cam);

    expect(fn).toHaveBeenCalledOnce();
  });

  it('removes only the one that unregistered, when two are identical', () => {
    const calls: string[] = [];
    const a = () => calls.push('a');
    const b = () => calls.push('b');
    const stopA = registerOverlay(a);
    cleanups.push(registerOverlay(b));

    stopA();
    runOverlays(ctx, cam);

    expect(calls).toEqual(['b']);
  });

  // A module drawing badly must not take the frame and the other overlays
  // down with it.
  it('runs the rest after one throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const after = vi.fn();
    add(() => {
      throw new Error('bad module');
    });
    add(after, OverlayLayer.hud);

    expect(() => runOverlays(ctx, cam)).not.toThrow();
    expect(after).toHaveBeenCalledOnce();
  });
});
