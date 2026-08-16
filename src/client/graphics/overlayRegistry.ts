import type { Camera } from './camera';

type OverlayFn = (ctx: CanvasRenderingContext2D, cam: Camera) => void;

/**
 * Draw order for overlays, so a minimap stays above a day/night tint
 * whatever order the modules load in.
 */
export const OverlayLayer = {
  /** In the world: markers, ranges, a tint over the scene. */
  world: 0,
  /** On the screen: minimap, counters, anything the world must not dim. */
  hud: 100,
} as const;

type Entry = { fn: OverlayFn; order: number };

const entries: Entry[] = [];

export function registerOverlay(
  fn: OverlayFn,
  order: number = OverlayLayer.world,
): () => void {
  entries.push({ fn, order });
  // Sorted on insert, since registering is rare and drawing is every frame.
  // The sort is stable, so one layer keeps arrival order.
  entries.sort((a, b) => a.order - b.order);
  return () => {
    const i = entries.findIndex((e) => e.fn === fn);
    if (i >= 0) entries.splice(i, 1);
  };
}

export function runOverlays(ctx: CanvasRenderingContext2D, cam: Camera): void {
  for (const entry of entries) {
    try {
      entry.fn(ctx, cam);
    } catch (e) {
      console.error('[overlay]', e);
    }
  }
}
