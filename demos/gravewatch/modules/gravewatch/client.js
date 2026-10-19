// @ts-check
// Asks for the night (server.js answers with the lamps), and says so on
// screen when the siege starts or ends.
engine.onServerEvent('gravewatch:siege', (payload) => {
  if (payload?.running) {
    engine.ui.notice(engine.t('The dead are rising'), {
      tone: 'danger',
      label: engine.t('Siege'),
      detail: engine.t('Hold both gates until dawn.'),
      ms: 6000,
    });
  } else {
    engine.ui.notice(engine.t('Dawn'), {
      tone: 'highlight',
      detail: engine.t('The dead crumble where they stand.'),
      ms: 5000,
    });
  }
});
engine.sendServerEvent('gravewatch:hello');

// The lamps' light over the night's dark. build.py renders what each lamp
// throws and server.js says where each stands. It goes on the fringe canvas
// with the dark, so the names drawn after the scene stay unlit.
/** @type {{ x: number, y: number, rect: number[] }[]} */
let lamps = [];
/** @type {HTMLImageElement | null} */
let lightSheet = null;
const lightCanvas = document.createElement('canvas');

engine.onServerEvent('gravewatch:lamps', (payload) => {
  if (!payload || !Array.isArray(payload.lamps)) return;
  lamps = payload.lamps;
  const src = `/theme/${payload.sheet}`;
  if (!lightSheet?.src.endsWith(src)) {
    lightSheet = new Image();
    lightSheet.src = src;
  }
});

// Summed on a buffer first: `lighter` straight onto the fringe would add
// each light's alpha to the dark's too. Drawn over the mist, so the mist
// round a lamp is lit.
engine.registerOverlay((ctx, cam) => {
  if (!lightSheet?.naturalWidth) return;
  if (
    lightCanvas.width !== ctx.canvas.width ||
    lightCanvas.height !== ctx.canvas.height
  ) {
    lightCanvas.width = ctx.canvas.width;
    lightCanvas.height = ctx.canvas.height;
  }
  const l = lightCanvas.getContext('2d');
  if (!l) return;
  const scale = ctx.canvas.width / engine.GAME_WIDTH;
  l.setTransform(scale, 0, 0, scale, 0, 0);
  l.clearRect(0, 0, engine.GAME_WIDTH, engine.GAME_HEIGHT);
  // The sheet is at the engine's scale: one cell across is half a tile wide.
  const o = engine.worldToScreen(0, 0);
  const k =
    (engine.worldToScreen(engine.TILE_SIZE, 0).x - o.x) /
    (engine.TILE_SIZE / 2);
  // Two lamps side by side light the ground between them twice.
  l.globalCompositeOperation = 'lighter';
  for (const { x, y, rect } of lamps) {
    const [sx, sy, w, h, cx, cy] = rect;
    const at = engine.worldToScreen(x, y);
    l.drawImage(
      lightSheet,
      sx,
      sy,
      w,
      h,
      at.x - cx * k,
      at.y - cy * k,
      w * k,
      h * k,
    );
  }
  l.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.translate(cam.x, cam.y);
  ctx.drawImage(lightCanvas, 0, 0, engine.GAME_WIDTH, engine.GAME_HEIGHT);
  ctx.restore();
}, engine.OverlayLayer.scene + 2);

// Mist: two sheets of wisps drifting at different speeds, so the pattern
// never repeats in step. Drawn over the dark since moonlight lights it, and
// thinned round the player and the lamps.
const FOG = {
  size: 800,
  wisps: 9,
  colour: '132,150,186',
  clear: 400,
  clearLamp: 260,
};
const sheets = [
  { canvas: fogSheet(0.3), vx: 9, vy: 2 },
  { canvas: fogSheet(0.18), vx: -5, vy: 3 },
];

/** Wisps flattened into ground banks, wrapped so the sheet tiles. */
function fogSheet(alpha) {
  const sheet = document.createElement('canvas');
  sheet.width = sheet.height = FOG.size;
  const g = sheet.getContext('2d');
  if (!g) return sheet;
  for (let i = 0; i < FOG.wisps; i++) {
    const x = Math.random() * FOG.size;
    const y = Math.random() * FOG.size;
    const r = 150 + Math.random() * 220;
    const a = alpha * (0.4 + Math.random() * 0.6);
    for (const dx of [-FOG.size, 0, FOG.size]) {
      for (const dy of [-FOG.size, 0, FOG.size]) {
        g.setTransform(1, 0, 0, 0.38, x + dx, y + dy);
        const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
        grad.addColorStop(0, `rgba(${FOG.colour},${a})`);
        grad.addColorStop(1, `rgba(${FOG.colour},0)`);
        g.fillStyle = grad;
        g.fillRect(-r, -r, r * 2, r * 2);
      }
    }
  }
  return sheet;
}

/** @type {HTMLCanvasElement | null} */
let fog = null;

engine.registerOverlay((ctx, cam) => {
  const width = engine.GAME_WIDTH;
  const height = engine.GAME_HEIGHT;
  const scale = ctx.canvas.width / width;
  fog ??= document.createElement('canvas');
  if (fog.width !== ctx.canvas.width || fog.height !== ctx.canvas.height) {
    fog.width = ctx.canvas.width;
    fog.height = ctx.canvas.height;
  }
  const b = fog.getContext('2d');
  if (!b) return;
  b.setTransform(scale, 0, 0, scale, 0, 0);
  b.clearRect(0, 0, width, height);
  b.globalCompositeOperation = 'source-over';
  const t = performance.now() / 1000;
  const wrap = (v) => ((v % FOG.size) + FOG.size) % FOG.size;
  // Pinned to the world: the camera moving slides the mist like the ground.
  for (const { canvas, vx, vy } of sheets) {
    const ox = wrap(t * vx - cam.x) - FOG.size;
    const oy = wrap(t * vy - cam.y) - FOG.size;
    for (let x = ox; x < width; x += FOG.size) {
      for (let y = oy; y < height; y += FOG.size) b.drawImage(canvas, x, y);
    }
  }

  /** Thins the mist in an ellipse round a world point, as the ground lies. */
  const clear = (x, y, radius) => {
    const o = engine.worldToScreen(x, y);
    b.setTransform(scale, 0, 0, scale * 0.6, o.x * scale, o.y * scale);
    const g = b.createRadialGradient(0, 0, 0, 0, 0, radius);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.45, 'rgba(0,0,0,0.9)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    b.fillStyle = g;
    b.fillRect(-radius, -radius, radius * 2, radius * 2);
  };
  b.globalCompositeOperation = 'destination-out';
  const player = engine.getPlayer();
  if (player) {
    const half = engine.TILE_SIZE / 2;
    clear(player.position.x + half, player.position.y + half, FOG.clear);
  }
  // And round the lamps, so it gathers in the dark woods and the lit
  // churchyard stays sharp.
  for (const lamp of lamps) clear(lamp.x, lamp.y, FOG.clearLamp);

  ctx.save();
  ctx.translate(cam.x, cam.y);
  ctx.drawImage(fog, 0, 0, width, height);
  ctx.restore();
}, engine.OverlayLayer.scene + 1);
