import { useEffect } from 'react';
import { initGameCanvas } from '../graphics/canvas';
import { initMapEditor } from '../graphics/mapEditor';

export const GameCanvas = () => {
  useEffect(() => {
    const stopObserving = initGameCanvas();
    initMapEditor();
    return stopObserving;
  }, []);

  return (
    <div id="canvasStack" aria-hidden="true">
      <canvas id="foregroundCanvas" width="1280" height="896"></canvas>
      <canvas id="maskCanvas" width="1280" height="896"></canvas>
      <canvas id="itemCanvas" width="1280" height="896"></canvas>
      <canvas id="gridCanvas" width="1280" height="896"></canvas>
      <canvas id="playerCanvas" width="1280" height="896"></canvas>
      <canvas id="fringeCanvas" width="1280" height="896"></canvas>
    </div>
  );
};
