export const backgroundCanvas = document.getElementById(
  'backgroundCanvas',
) as HTMLCanvasElement;
export const backgroundCtx = backgroundCanvas.getContext(
  '2d',
) as CanvasRenderingContext2D;

export const foregroundCanvas = document.getElementById(
  'foregroundCanvas',
) as HTMLCanvasElement;
export const foregroundCtx = foregroundCanvas.getContext(
  '2d',
) as CanvasRenderingContext2D;
