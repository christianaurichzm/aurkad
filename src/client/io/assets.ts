import { loadImageFromBin } from './network';
import { imageMap } from '../../shared/mappings';
import { buildEntityAtlas } from '../graphics/atlas';

export let tileset: ImageBitmap;
export let tilesetAlpha: HTMLCanvasElement;
export let spriteSheet: ImageBitmap;
export let items: ImageBitmap;
export let spellSheet: HTMLCanvasElement;
export let arrowSheet: HTMLCanvasElement;
export let attackEffectSheet: HTMLCanvasElement;

let _assetKey = '';

export function setAssetKey(hexKey: string): void {
  _assetKey = hexKey;
}

const getUrl = (type: keyof typeof imageMap) => `assets/${imageMap[type]}.bin`;

function makeColorKeyCanvas(bitmap: ImageBitmap): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imageData.data;
  const w = canvas.width,
    h = canvas.height;
  const cornerIdx = [0, w - 1, (h - 1) * w, (h - 1) * w + (w - 1)];
  if (cornerIdx.some((i) => d[i * 4 + 3] === 0)) return canvas;
  const freq = new Map<string, number>();
  for (const i of cornerIdx) {
    const k = `${d[i * 4]},${d[i * 4 + 1]},${d[i * 4 + 2]}`;
    freq.set(k, (freq.get(k) ?? 0) + 1);
  }
  const bgKey = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const [bgR, bgG, bgB] = bgKey.split(',').map(Number);
  for (let i = 0; i < d.length; i += 4) {
    if (
      Math.abs(d[i] - bgR) <= 2 &&
      Math.abs(d[i + 1] - bgG) <= 2 &&
      Math.abs(d[i + 2] - bgB) <= 2
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

const initSpellSheet = async () => {
  const bmp = await loadImageFromBin(getUrl('spells'), _assetKey);
  spellSheet = makeColorKeyCanvas(bmp);
};

const initArrowSheet = async () => {
  const bmp = await loadImageFromBin(getUrl('arrows'), _assetKey);
  arrowSheet = makeColorKeyCanvas(bmp);
};

const initAttackEffectSheet = async () => {
  const bmp = await loadImageFromBin(getUrl('attackeffect'), _assetKey);
  attackEffectSheet = makeColorKeyCanvas(bmp);
};

export const initializeAssets = () => {
  if (!_assetKey) throw new Error('Asset key not set - call setAssetKey first');
  return Promise.all([
    initTileset(),
    initSpriteSheet(),
    initItems(),
    initSpellSheet(),
    initArrowSheet(),
    initAttackEffectSheet(),
  ]).then(([loadedTileset, loadedSpriteSheet]) => {
    buildEntityAtlas({
      sprites: spriteSheet,
      items,
      spells: spellSheet,
      arrows: arrowSheet,
      attackEffect: attackEffectSheet,
    });
    return { tileset: loadedTileset, spriteSheet: loadedSpriteSheet };
  });
};
