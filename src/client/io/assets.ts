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
  if (d[3] === 0) return canvas;
  const bgR = d[0],
    bgG = d[1],
    bgB = d[2];
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

export const initializeAssets = async () => {
  if (!_assetKey) throw new Error('Asset key not set - call setAssetKey first');
  // allSettled, so the atlas is built from whatever arrived. With all, one
  // sheet missing from the install would leave no atlas, and every player and
  // NPC would draw as just a name and a health bar.
  const results = await Promise.allSettled([
    initTileset(),
    initSpriteSheet(),
    initItems(),
    initSpellSheet(),
    initArrowSheet(),
    initAttackEffectSheet(),
  ]);
  for (const result of results) {
    if (result.status === 'rejected')
      console.error('[assets] sheet not loaded', result.reason);
  }
  buildEntityAtlas({
    sprites: spriteSheet,
    items,
    spells: spellSheet,
    arrows: arrowSheet,
    attackEffect: attackEffectSheet,
  });
  return { tileset, spriteSheet };
};
