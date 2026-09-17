export interface AtlasEntry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type EntityAtlasKey =
  'sprites' | 'items' | 'spells' | 'arrows' | 'attackEffect';

export let entityAtlas: HTMLCanvasElement | null = null;
export const entityAtlasOffsets: Partial<Record<EntityAtlasKey, AtlasEntry>> =
  {};

export function buildEntityAtlas(
  sources: Partial<Record<EntityAtlasKey, ImageBitmap | HTMLCanvasElement>>,
): void {
  // A sheet that failed to load is left out; each consumer skips a missing
  // key, so the other sheets still draw.
  const entries = Object.entries(sources).filter(([, img]) => img) as [
    EntityAtlasKey,
    ImageBitmap | HTMLCanvasElement,
  ][];
  if (!entries.length) return;

  const atlasWidth = Math.max(...entries.map(([, img]) => img.width));
  const atlasHeight = entries.reduce((sum, [, img]) => sum + img.height, 0);

  const canvas = document.createElement('canvas');
  canvas.width = atlasWidth;
  canvas.height = atlasHeight;
  const ctx = canvas.getContext('2d')!;

  let y = 0;
  for (const [key, img] of entries) {
    ctx.drawImage(img, 0, y);
    entityAtlasOffsets[key] = { x: 0, y, width: img.width, height: img.height };
    y += img.height;
  }

  entityAtlas = canvas;
}
