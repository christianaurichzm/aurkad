import { getEl } from '../utils/domHelpers';

export let foregroundCanvas: HTMLCanvasElement;
export let foregroundCtx: CanvasRenderingContext2D;

export let maskCanvas: HTMLCanvasElement;
export let maskCtx: CanvasRenderingContext2D;

export let playerCanvas: HTMLCanvasElement;
export let playerCtx: CanvasRenderingContext2D;

export let itemCanvas: HTMLCanvasElement;
export let itemCtx: CanvasRenderingContext2D;

export let fringeCanvas: HTMLCanvasElement;
export let fringeCtx: CanvasRenderingContext2D;

// The world is drawn 1280 wide everywhere, so on a phone a 15px name comes
// out at 5. World text grows by what the screen took away, up to twice.
const READABLE = 0.73;
let worldTextScale = 1;

const fitWorldText = () => {
  const shown = playerCanvas.clientWidth / playerCanvas.width;
  worldTextScale = shown > 0 ? Math.min(2, Math.max(1, READABLE / shown)) : 1;
};

/**
 * Runs `draw` with the world's text at the size the screen needs, growing
 * from (x, y): the point a label hangs from stays where it is.
 */
export const worldText = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  draw: () => void,
) => {
  if (worldTextScale === 1) return draw();
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(worldTextScale, worldTextScale);
  ctx.translate(-x, -y);
  draw();
  ctx.restore();
};

export const initGameCanvas = () => {
  foregroundCanvas = getEl<HTMLCanvasElement>('foregroundCanvas')!;
  if (!foregroundCanvas) throw new Error('foregroundCanvas element not found');

  maskCanvas = getEl<HTMLCanvasElement>('maskCanvas')!;
  if (!maskCanvas) throw new Error('maskCanvas element not found');

  playerCanvas = getEl<HTMLCanvasElement>('playerCanvas')!;
  if (!playerCanvas) throw new Error('playerCanvas element not found');

  itemCanvas = getEl<HTMLCanvasElement>('itemCanvas')!;
  if (!itemCanvas) throw new Error('itemCanvas element not found');

  fringeCanvas = getEl<HTMLCanvasElement>('fringeCanvas')!;
  if (!fringeCanvas) throw new Error('fringeCanvas element not found');

  foregroundCtx = foregroundCanvas.getContext('2d')!;
  maskCtx = maskCanvas.getContext('2d')!;
  playerCtx = playerCanvas.getContext('2d')!;
  itemCtx = itemCanvas.getContext('2d')!;
  fringeCtx = fringeCanvas.getContext('2d')!;

  // Nearest neighbour on every layer. The art is pixel art and the browser
  // resamples bilinearly by default, so a tile or sprite between two pixels
  // comes out soft. The camera and the slide snap to whole pixels
  // (camera.ts, movementAnimation.ts); this stops the resampling itself.
  for (const ctx of [foregroundCtx, maskCtx, playerCtx, itemCtx, fringeCtx]) {
    ctx.imageSmoothingEnabled = false;
  }

  fitWorldText();
  new ResizeObserver(fitWorldText).observe(playerCanvas);
};
