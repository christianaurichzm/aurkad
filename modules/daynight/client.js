// @ts-check
// Day/night, client only: a tint whose phase comes from the UTC wall clock,
// so every client sees the same hour with nothing sent over the wire.
//
// With no server half there is no `config` global; the constants below
// are the settings.

const CYCLE_MINUTES = 60; // one in-game day per real hour
const CYCLE_MS = CYCLE_MINUTES * 60 * 1000;

// Keys are the phase of the cycle: 0 is midnight, 0.5 is noon. Between two
// stops the colour and the strength are interpolated, so nothing steps.
const STOPS = [
  { at: 0.0, color: [12, 20, 60], alpha: 0.55 }, // deep night
  { at: 0.22, color: [40, 30, 70], alpha: 0.42 }, // before dawn
  { at: 0.3, color: [255, 150, 80], alpha: 0.22 }, // sunrise
  { at: 0.42, color: [255, 220, 160], alpha: 0.05 },
  { at: 0.5, color: [255, 255, 255], alpha: 0.0 }, // noon: no tint at all
  { at: 0.62, color: [255, 220, 160], alpha: 0.05 },
  { at: 0.75, color: [255, 120, 60], alpha: 0.24 }, // sunset
  { at: 0.85, color: [40, 30, 70], alpha: 0.42 },
  { at: 1.0, color: [12, 20, 60], alpha: 0.55 }, // back to midnight
];

const lerp = (a, b, t) => a + (b - a) * t;

function tintAt(phase) {
  let lo = STOPS[0];
  let hi = STOPS[STOPS.length - 1];
  for (let i = 0; i < STOPS.length - 1; i++) {
    if (phase >= STOPS[i].at && phase <= STOPS[i + 1].at) {
      lo = STOPS[i];
      hi = STOPS[i + 1];
      break;
    }
  }
  const span = hi.at - lo.at;
  const t = span > 0 ? (phase - lo.at) / span : 0;
  return {
    r: Math.round(lerp(lo.color[0], hi.color[0], t)),
    g: Math.round(lerp(lo.color[1], hi.color[1], t)),
    b: Math.round(lerp(lo.color[2], hi.color[2], t)),
    a: lerp(lo.alpha, hi.alpha, t),
  };
}

/** Phase of the cycle right now, 0..1, shared by every client on wall time. */
function currentPhase() {
  return (Date.now() % CYCLE_MS) / CYCLE_MS;
}

engine.registerOverlay((ctx, cam) => {
  const tint = tintAt(currentPhase());
  if (tint.a <= 0.001) return;

  ctx.save();
  // Screen space: the sky covers the view, not a rectangle of the world.
  ctx.translate(cam.x, cam.y);
  ctx.fillStyle = `rgba(${tint.r},${tint.g},${tint.b},${tint.a})`;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}, engine.OverlayLayer.scene);
