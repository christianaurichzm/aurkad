import { loadImageFromBin } from './network';
import { imageMap } from '../../shared/mappings';

export let tileset: HTMLImageElement;
export let spriteSheet: HTMLImageElement;
export let items: HTMLImageElement;

const getUrl = (type: keyof typeof imageMap) => {
  return `assets/${imageMap[type]}.bin`;
};

export const initTileset = async () => {
  try {
    tileset = await loadImageFromBin(getUrl('tiles'));
    return tileset;
  } catch (err) {
    throw new Error('Failed to load tileset');
  }
};

export const initSpriteSheet = async () => {
  try {
    spriteSheet = await loadImageFromBin(getUrl('sprites'));
    return spriteSheet;
  } catch (err) {
    throw new Error('Failed to load spritesheet');
  }
};

export const initItems = async () => {
  try {
    items = await loadImageFromBin(getUrl('items'));
    return items;
  } catch (err) {
    throw new Error('Failed to load items');
  }
};

export const initializeAssets = () => {
  return Promise.all([initTileset(), initSpriteSheet(), initItems()])
    .then(([loadedTileset, loadedSpriteSheet]) => {
      console.log('All assets loaded');
      return { tileset: loadedTileset, spriteSheet: loadedSpriteSheet };
    })
    .catch((error) => {
      console.error('Error loading assets:', error);
      throw error;
    });
};
