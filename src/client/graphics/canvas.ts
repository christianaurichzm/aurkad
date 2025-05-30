import { getEl } from '../utils/domHelpers';

export let foregroundCanvas: HTMLCanvasElement;
export let foregroundCtx: CanvasRenderingContext2D;

export let playerCanvas: HTMLCanvasElement;
export let playerCtx: CanvasRenderingContext2D;

export let itemCanvas: HTMLCanvasElement;
export let itemCtx: CanvasRenderingContext2D;

export const initGameCanvas = () => {
  foregroundCanvas = getEl<HTMLCanvasElement>('foregroundCanvas')!;
  if (!foregroundCanvas) throw new Error('foregroundCanvas element not found');

  playerCanvas = getEl<HTMLCanvasElement>('playerCanvas')!;
  if (!playerCanvas) throw new Error('playerCanvas element not found');

  itemCanvas = getEl<HTMLCanvasElement>('itemCanvas')!;
  if (!itemCanvas) throw new Error('itemCanvas element not found');

  foregroundCtx = foregroundCanvas.getContext('2d')!;
  playerCtx = playerCanvas.getContext('2d')!;
  itemCtx = itemCanvas.getContext('2d')!;
};
