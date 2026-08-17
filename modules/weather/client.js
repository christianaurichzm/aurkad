// @ts-check
// Weather, client only: rain and snow over the world. A script's last
// `weather` event wins; otherwise a wall-clock cycle, which every client
// sees the same with nothing sent:
//
//   sendEvent(player, 'weather', { kind: 'rain', intensity: 0.6 })
//
// With no server half there is no `config` global; the constants below
// are the settings.

const CYCLE_MINUTES = 30; // one turn of the default weather wheel
const CYCLE_MS = CYCLE_MINUTES * 60 * 1000;
const MAX_PARTICLES = 260;

const KINDS = {
  clear: { count: 0 },
  rain: {
    count: MAX_PARTICLES,
    color: 'rgba(186,214,255,0.75)',
    speed: 900, // px per second, downward
    drift: -120,
    length: 14,
    width: 1,
  },
  snow: {
    count: Math.round(MAX_PARTICLES * 0.6),
    color: 'rgba(255,255,255,0.8)',
    speed: 90,
    drift: 40,
    length: 0, // drawn as a dot
    width: 2.5,
  },
};

/** What the wheel says when nothing has been pushed: mostly clear, then wet. */
function scheduled() {
  const phase = (Date.now() % CYCLE_MS) / CYCLE_MS;
  if (phase < 0.55) return { kind: 'clear', intensity: 0 };
  if (phase < 0.8) return { kind: 'rain', intensity: (phase - 0.55) / 0.25 };
  return { kind: 'snow', intensity: (1 - phase) / 0.2 };
}

let pushed = null;

engine.onServerEvent('weather', (payload) => {
  if (!payload || typeof payload !== 'object') {
    pushed = null; // anything unreadable hands control back to the wheel
    return;
  }
  const kind = String(payload.kind || 'clear');
  pushed = {
    kind: kind in KINDS ? kind : 'clear',
    intensity: Math.max(0, Math.min(1, Number(payload.intensity ?? 1))),
  };
});

// Particles live in world space, so they do not slide with the camera.
const drops = [];

function reseed(count, cam, ctx) {
  while (drops.length > count) drops.pop();
  while (drops.length < count) {
    drops.push({
      x: cam.x + Math.random() * ctx.canvas.width,
      y: cam.y + Math.random() * ctx.canvas.height,
      // A little spread, so a sheet of rain is not one rigid comb.
      jitter: 0.7 + Math.random() * 0.6,
    });
  }
}

let lastFrame = 0;

engine.registerOverlay((ctx, cam) => {
  const weather = pushed ?? scheduled();
  const spec = KINDS[weather.kind];
  if (!spec || !spec.count || weather.intensity <= 0.01) {
    drops.length = 0;
    return;
  }

  const now = performance.now();
  // Clamped, so a tab back from the background does not jump every drop.
  const dt = Math.min(0.05, lastFrame ? (now - lastFrame) / 1000 : 0.016);
  lastFrame = now;

  reseed(Math.round(spec.count * weather.intensity), cam, ctx);

  ctx.save();
  ctx.strokeStyle = spec.color;
  ctx.fillStyle = spec.color;
  ctx.lineWidth = spec.width;

  const bottom = cam.y + ctx.canvas.height;
  const right = cam.x + ctx.canvas.width;

  for (const drop of drops) {
    drop.y += spec.speed * drop.jitter * dt;
    drop.x += spec.drift * drop.jitter * dt;

    // Wrapped against the camera rather than respawned, so walking does not
    // sweep the weather off the screen.
    if (drop.y > bottom) {
      drop.y = cam.y - 10;
      drop.x = cam.x + Math.random() * ctx.canvas.width;
    }
    if (drop.x > right) drop.x = cam.x;
    if (drop.x < cam.x) drop.x = right;

    if (spec.length) {
      ctx.beginPath();
      ctx.moveTo(drop.x, drop.y);
      ctx.lineTo(drop.x - spec.drift * 0.01, drop.y + spec.length);
      ctx.stroke();
    } else {
      ctx.fillRect(drop.x, drop.y, spec.width, spec.width);
    }
  }

  ctx.restore();
}, engine.OverlayLayer.world);
