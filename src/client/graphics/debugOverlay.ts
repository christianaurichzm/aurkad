import { registerOverlay } from './overlayRegistry';
import { getGameState, getPlayer } from '../core/gameState';
import { getAnimatedState } from './movementAnimation';
import { TILE_SIZE } from '../../shared/constants';

let visible = false;

const FRAME_SAMPLES = 60;
const frameTimes: number[] = [];

function calcFps(now: number): number {
  frameTimes.push(now);
  if (frameTimes.length > FRAME_SAMPLES) frameTimes.shift();
  if (frameTimes.length < 2) return 0;
  return (frameTimes.length - 1) / ((now - frameTimes[0]!) / 1000);
}

export function initDebugOverlay(): void {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F8') {
      e.preventDefault();
      visible = !visible;
    }
  });

  registerOverlay((ctx, cam) => {
    if (!visible) return;

    const fps = calcFps(performance.now());
    const gs = getGameState();
    const player = getPlayer();

    const playerCount = gs ? Object.keys(gs.players).length : 0;
    const npcCount = gs ? Object.keys(gs.npcs).length : 0;

    let tileX = 0;
    let tileY = 0;
    if (player) {
      const pos = getAnimatedState(player.id, player.position).position;
      tileX = Math.floor(pos.x / TILE_SIZE);
      tileY = Math.floor(pos.y / TILE_SIZE);
    }

    const lines = [
      `FPS ${Math.round(fps)}`,
      `Entities ${playerCount}p ${npcCount}n`,
      `Tile ${tileX},${tileY}`,
      `Cam ${Math.round(cam.x)},${Math.round(cam.y)}`,
    ];

    const W = 148;
    const H = lines.length * 16 + 8;

    ctx.save();
    ctx.translate(cam.x, cam.y);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(4, 4, W, H);
    ctx.fillStyle = '#00ff88';
    ctx.font = '12px monospace';
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i]!, 10, 18 + i * 16);
    }
    ctx.restore();
  });
}
