import { loadImageFromBin } from './network';
import { imageMap } from '../../shared/mappings';

export let tileset: ImageBitmap;
export let spriteSheet: ImageBitmap;
export let items: ImageBitmap;

let _assetKey = '';

export function setAssetKey(hexKey: string): void {
  _assetKey = hexKey;
}

const getUrl = (type: keyof typeof imageMap) => `assets/${imageMap[type]}.bin`;

export const initTileset = async () => {
  tileset = await loadImageFromBin(getUrl('tiles'), _assetKey);
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
