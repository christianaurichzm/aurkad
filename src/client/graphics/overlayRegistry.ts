import type { Camera } from './camera';

type OverlayFn = (ctx: CanvasRenderingContext2D, cam: Camera) => void;

/**
 * Draw order for overlays, so a minimap stays above a day/night tint
 * whatever order the modules load in.
 */
export const OverlayLayer = {
  /** In the world, under tree tops and roofs: markers, ranges, spell glow. */
  world: 0,
  /**
   * Over the whole scene, tree tops and roofs included, under the names: the
   * dark, a tint, the rain. A night that a roof pokes through is not a night.
   */
  scene: 50,
  /** On the screen: minimap, counters, anything the world must not dim. */
  hud: 100,
} as const;

type Entry = { fn: OverlayFn; order: number };

const layerOf = (order: number) =>
  order >= OverlayLayer.hud
    ? OverlayLayer.hud
    : order >= OverlayLayer.scene
      ? OverlayLayer.scene
      : OverlayLayer.world;

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

/**
 * With no `layer`, every overlay. With one, only that layer: `world` draws on
 * the entities' canvas, which the fringe (tree tops, roofs) paints over;
 * `scene` on the fringe's, after it; `hud` on the text canvas above both,
 * after the names.
 */
export function runOverlays(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  layer?: number,
): void {
  for (const entry of entries) {
    if (layer !== undefined && layerOf(entry.order) !== layer) continue;
    try {
      entry.fn(ctx, cam);
    } catch (e) {
      console.error('[overlay]', e);
    }
  }
}
