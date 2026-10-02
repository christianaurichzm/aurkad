import { GAME_HEIGHT, GAME_WIDTH } from '../../shared/constants';
import { fetchGameBrand, getGameBrand } from '../io/network/http/authClient';
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

// Pixel art keeps the logical buffer; smooth art uses device pixels so the
// sheet is filtered directly to screen resolution. Six layers grow with the
// square of this scale, so allocation stops at twice the logical view.
const MAX_WORLD_SCALE = 2;
export let worldScale = 1;
/** Moves whenever the world's canvases are reallocated, which clears them. */
export let worldCanvasGeneration = 0;

/**
 * The part of the world view the player sees, in view pixels: all of it
 * unless the overlay layout crops it. A minimap pins to this; `scale` is
 * CSS pixels per view pixel.
 */
export let visibleView = {
  x: 0,
  y: 0,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  scale: 1,
};

const smoothArt = () => getGameBrand()?.art === 'smooth';

/** World coordinates on a device-sized buffer, with the game's filtering. */
export const prepareWorldContext = (
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  scale = worldScale,
) => {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingEnabled = smoothArt();
  ctx.imageSmoothingQuality = 'high';
};

const worldCanvases = () =>
  [
    foregroundCanvas,
    maskCanvas,
    itemCanvas,
    getEl<HTMLCanvasElement>('gridCanvas'),
    playerCanvas,
    fringeCanvas,
  ].filter((canvas): canvas is HTMLCanvasElement => !!canvas);

// Where the frame crops the world (the overlay layout makes it cover the
// window), in the view's pixels; the whole view where it does not.
const visiblePart = (): typeof visibleView => {
  const box = playerCanvas.getBoundingClientRect();
  const frame = playerCanvas.closest('#canvasFrame')?.getBoundingClientRect();
  if (!frame || !box.width || !box.height)
    return { x: 0, y: 0, width: GAME_WIDTH, height: GAME_HEIGHT, scale: 1 };
  const perX = GAME_WIDTH / box.width;
  const perY = GAME_HEIGHT / box.height;
  const left = Math.max(box.left, frame.left);
  const top = Math.max(box.top, frame.top);
  return {
    x: (left - box.left) * perX,
    y: (top - box.top) * perY,
    width: Math.max(0, Math.min(box.right, frame.right) - left) * perX,
    height: Math.max(0, Math.min(box.bottom, frame.bottom) - top) * perY,
    scale: 1 / perX,
  };
};

const fitWorld = (prepare = false) => {
  const shown = playerCanvas.clientWidth / GAME_WIDTH;
  worldTextScale = shown > 0 ? Math.min(2, Math.max(1, READABLE / shown)) : 1;
  visibleView = visiblePart();

  const scale = smoothArt()
    ? Math.min(MAX_WORLD_SCALE, Math.max(1, shown * devicePixelRatio))
    : 1;
  const width = Math.round(GAME_WIDTH * scale);
  const height = Math.round(GAME_HEIGHT * (width / GAME_WIDTH));
  const canvases = worldCanvases();
  const resized = canvases.some(
    (canvas) => canvas.width !== width || canvas.height !== height,
  );
  if (!resized && !prepare) return;
  worldScale = width / GAME_WIDTH;
  for (const canvas of canvases) {
    if (resized) {
      canvas.width = width;
      canvas.height = height;
    }
    prepareWorldContext(canvas.getContext('2d')!);
  }
  worldCanvasGeneration++;
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

  fitWorld(true);
  let active = true;
  // The game's art is known from /game, asked at boot; if it lands after the
  // canvases, it can change both their size and their filtering.
  void fetchGameBrand().then(() => active && fitWorld(true));
  const observer = new ResizeObserver(() => fitWorld());
  observer.observe(playerCanvas);
  const frame = playerCanvas.closest('#canvasFrame');
  if (frame) observer.observe(frame);
  return () => {
    active = false;
    observer.disconnect();
  };
};
