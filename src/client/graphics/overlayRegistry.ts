import type { Camera } from './camera';

type OverlayFn = (ctx: CanvasRenderingContext2D, cam: Camera) => void;

const fns: OverlayFn[] = [];

export function registerOverlay(fn: OverlayFn): () => void {
  fns.push(fn);
  return () => {
    const i = fns.indexOf(fn);
    if (i >= 0) fns.splice(i, 1);
  };
}

export function runOverlays(ctx: CanvasRenderingContext2D, cam: Camera): void {
  for (const fn of fns) {
    try {
      fn(ctx, cam);
    } catch (e) {
      console.error('[overlay]', e);
    }
  }
}
