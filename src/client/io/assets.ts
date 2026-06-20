import { loadImageFromBin } from './network';
import { imageMap } from '../../shared/mappings';

export let tileset: ImageBitmap;
export let tilesetAlpha: HTMLCanvasElement;
export let spriteSheet: ImageBitmap;
export let items: ImageBitmap;

let _assetKey = '';

export function setAssetKey(hexKey: string): void {
  _assetKey = hexKey;
}

const getUrl = (type: keyof typeof imageMap) => `assets/${imageMap[type]}.bin`;

function makeColorKeyCanvas(
  bitmap: ImageBitmap,
  tolerance = 20,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imageData.data;
  const bgR = d[0],
    bgG = d[1],
    bgB = d[2];
  for (let i = 0; i < d.length; i += 4) {
    if (
      Math.abs(d[i] - bgR) <= tolerance &&
      Math.abs(d[i + 1] - bgG) <= tolerance &&
      Math.abs(d[i + 2] - bgB) <= tolerance
    ) {
      d[i + 3] = 0;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

export const initTileset = async () => {
  tileset = await loadImageFromBin(getUrl('tiles'), _assetKey);
  tilesetAlpha = makeColorKeyCanvas(tileset);
  return tileset;
};

export const initSpriteSheet = async () => {
  spriteSheet = await loadImageFromBin(getUrl('sprites'), _assetKey);
  return spriteSheet;
};

export const initItems = async () => {
  items = await loadImageFromBin(getUrl('items'), _assetKey);
  return items;
};

export const initializeAssets = () => {
  if (!_assetKey) throw new Error('Asset key not set - call setAssetKey first');
  return Promise.all([initTileset(), initSpriteSheet(), initItems()]).then(
    ([loadedTileset, loadedSpriteSheet]) => ({
      tileset: loadedTileset,
      spriteSheet: loadedSpriteSheet,
    }),
  );
};
