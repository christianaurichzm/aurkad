// @ts-check
// Lighting, client only: darkness over the world with holes where the
// lights are. It is built offscreen, since `destination-out` on the game
// canvas would erase the world under each light.
//
// Lights come from the last `lighting` event a script sent, else from the
// constants below plus the player's own light:
//
//   sendEvent(player, 'lighting', { ambient: 0.85, lights: [{ x, y }] })
//
// Turning this module on makes the world dark. A game dark only at night
// sends `ambient` from its day/night script, or the two darknesses stack.

const DEFAULT_AMBIENT = 0.72; // 0 = noon, 1 = pitch black
const PLAYER_LIGHT = { radius: 170, flicker: 0.04 };
const DARK = [4, 6, 16];

// No colour per light: a warm additive pass reads as haze over the tiles,
// not as a flame. A light here reveals; it does not paint.

/** @typedef {{ x: number, y: number, radius?: number, flicker?: number }} Light */

let ambient = DEFAULT_AMBIENT;
/** @type {Light[]} */
let lights = [];
let carried = true;

engine.onServerEvent('lighting', (payload) => {
  if (!payload || typeof payload !== 'object') return;
  if (typeof payload.ambient === 'number') {
    ambient = Math.max(0, Math.min(1, payload.ambient));
  }
  if (Array.isArray(payload.lights)) {
    lights = payload.lights.filter(
      (l) => l && typeof l.x === 'number' && typeof l.y === 'number',
    );
  }
  if (typeof payload.playerLight === 'boolean') carried = payload.playerLight;
});

/** @type {HTMLCanvasElement | null} */
let buffer = null;
/** @type {CanvasRenderingContext2D | null} */
let bctx = null;

function bufferFor(width, height) {
  if (!buffer) {
    buffer = document.createElement('canvas');
    bctx = buffer.getContext('2d');
  }
  if (buffer.width !== width || buffer.height !== height) {
    buffer.width = width;
    buffer.height = height;
  }
  return bctx;
}

/**
 * A still torch reads as a spotlight. The wobble is a sine on wall time
 * seeded by position, so it needs no state and clients agree.
 */
function flickerScale(light, now) {
  const amount = typeof light.flicker === 'number' ? light.flicker : 0;
  if (amount <= 0) return 1;
  const seed = (light.x * 0.7 + light.y * 1.3) % 6.283;
  return 1 + amount * Math.sin(now / 90 + seed);
}

function visibleLights() {
  const all = lights.slice();
  const player = carried ? engine.getPlayer() : undefined;
  if (player) {
    all.push({
      x: player.position.x + engine.TILE_SIZE / 2,
      y: player.position.y + engine.TILE_SIZE / 2,
      radius: PLAYER_LIGHT.radius,
      flicker: PLAYER_LIGHT.flicker,
    });
  }
  return all;
}

engine.registerOverlay((ctx, cam) => {
  if (ambient <= 0.001) return;

  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const b = bufferFor(width, height);
  if (!b) return; // no 2d context: better unlit than half-drawn

  const now = Date.now();
  const visible = visibleLights();

  b.clearRect(0, 0, width, height);
  b.globalCompositeOperation = 'source-over';
  b.fillStyle = `rgba(${DARK[0]},${DARK[1]},${DARK[2]},${ambient})`;
  b.fillRect(0, 0, width, height);

  // Punch the holes. Soft-edged, because a hard rim reads as a cut-out.
  b.globalCompositeOperation = 'destination-out';
  for (const light of visible) {
    const r = (light.radius || 140) * flickerScale(light, now);
    const sx = light.x - cam.x;
    const sy = light.y - cam.y;
    const g = b.createRadialGradient(sx, sy, 0, sx, sy, r);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.82)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    b.fillStyle = g;
    b.fillRect(sx - r, sy - r, r * 2, r * 2);
  }
  b.globalCompositeOperation = 'source-over';

  ctx.save();
  // Screen space: darkness covers the view, not a rectangle of the world.
  ctx.translate(cam.x, cam.y);
  ctx.drawImage(buffer, 0, 0);
  ctx.restore();
}, engine.OverlayLayer.scene);
