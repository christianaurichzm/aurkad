import { useEffect } from 'react';
import { initGameCanvas } from '../graphics/canvas';
import { initTilesetEditor } from '../graphics/tileset';

export const GameCanvas = () => {
  useEffect(() => {
    initGameCanvas();
    initTilesetEditor();
  }, []);

  return (
    <>
      <canvas id="foregroundCanvas" width="1280" height="896"></canvas>
      <canvas id="itemCanvas" width="1280" height="896"></canvas>
      <canvas id="gridCanvas" width="1280" height="896"></canvas>
      <canvas id="playerCanvas" width="1280" height="896"></canvas>
    </>
  );
};
