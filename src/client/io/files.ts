export let tileset: HTMLImageElement;
export let spriteSheet: HTMLImageElement;

export const initTileset = () => {
  return new Promise((resolve, reject) => {
    tileset = new Image();
    tileset.onload = () => {
      console.log('Tileset loaded');
      resolve(tileset);
    };
    tileset.onerror = () => {
      reject(new Error('Failed to load tileset'));
    };
    tileset.src = 'Tiles.png';
  });
};

export const initSpriteSheet = () => {
  return new Promise((resolve, reject) => {
    spriteSheet = new Image();
    spriteSheet.onload = () => {
      console.log('Spritesheet loaded');
      resolve(spriteSheet);
    };
    spriteSheet.onerror = () => {
      reject(new Error('Failed to load spritesheet'));
    };
    spriteSheet.src = 'Sprites.png';
  });
};

export const initializeAssets = () => {
  return Promise.all([initTileset(), initSpriteSheet()])
    .then(([loadedTileset, loadedSpriteSheet]) => {
      console.log('Both tileset and spritesheet loaded');
      return { tileset: loadedTileset, spriteSheet: loadedSpriteSheet };
    })
    .catch((error) => {
      console.error('Error loading assets:', error);
      throw error;
    });
};
