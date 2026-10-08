// @ts-check
// Cutscene, client only: letterbox bars, a caption box and the keyboard held
// still while the lines play.
//
//   sendEvent(player, 'cutscene', {
//     speaker: 'Gatekeeper',
//     lines: ['The gate groans open.', 'Something moves inside.'],
//     auto: 2500,          // ms per line; omit to advance on a click or Enter
//   })
//   on('customAction', ...)  // 'cutscene:done' comes back when it ends
//
// Sending `null` ends whatever is playing; a script's `finally` should, so a
// cancelled coroutine leaves no bars up. A capture-phase listener swallows
// keydown before the engine sees it, but keyups pass so held keys release.

const BAR_FRACTION = 0.12; // of view height, per bar
const SLIDE_MS = 320;
const BOX_HEIGHT = 78;
const SIDE_PAD = 90;

/** @type {{ lines: string[], index: number, speaker: string, auto: number, startedAt: number, lineAt: number, font: string } | null} */
let scene = null;

function end() {
  if (!scene) return;
  scene = null;
  window.removeEventListener('keydown', onKeyDown, true);
  window.removeEventListener('mousedown', onClick);
  engine.sendServerEvent('cutscene:done');
}

function advance() {
  if (!scene) return;
  scene.index++;
  scene.lineAt = Date.now();
  if (scene.index >= scene.lines.length) end();
}

/** @param {KeyboardEvent} e */
function onKeyDown(e) {
  if (!scene) return;
  e.stopPropagation();
  e.preventDefault();
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
    if (e.key === 'Escape') end();
    else advance();
  }
}

function onClick() {
  advance();
}

engine.onServerEvent('cutscene', (payload) => {
  const lines =
    payload && Array.isArray(payload.lines)
      ? payload.lines.filter((l) => typeof l === 'string' && l.length > 0)
      : [];
  if (lines.length === 0) {
    end();
    return;
  }

  const fresh = !scene;
  scene = {
    lines,
    index: 0,
    speaker: typeof payload.speaker === 'string' ? payload.speaker : '',
    auto: typeof payload.auto === 'number' ? payload.auto : 0,
    startedAt: Date.now(),
    lineAt: Date.now(),
    // The caption uses the theme's font, read once per scene.
    font:
      getComputedStyle(document.documentElement)
        .getPropertyValue('--font-ui')
        .trim() || 'sans-serif',
  };
  if (fresh) {
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('mousedown', onClick);
  }
});

/** Wraps to the box width, so a long line is read rather than clipped. */
function wrap(ctx, text, maxWidth) {
  const words = text.split(' ');
  const out = [];
  let line = '';
  for (const word of words) {
    const next = line ? line + ' ' + word : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      out.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) out.push(line);
  return out;
}

// On the hud layer, so no tint or darkness paints over the bars, and last
// on it so they cover the minimap too.
engine.registerOverlay((ctx, cam) => {
  if (!scene) return;
  const { font } = scene;

  const now = Date.now();
  if (scene.auto > 0 && now - scene.lineAt >= scene.auto) {
    advance();
    if (!scene) return;
  }

  const view = engine.getVisibleView();
  const { width, height } = view;
  const slide = Math.min(1, (now - scene.startedAt) / SLIDE_MS);
  const bar = height * BAR_FRACTION * slide;

  ctx.save();
  // Screen space: the frame belongs to the view, not to a piece of the world.
  ctx.translate(cam.x + view.x, cam.y + view.y);

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, bar);
  ctx.fillRect(0, height - bar, width, bar);

  const line = scene.lines[scene.index];
  if (line) {
    ctx.font = `16px ${font}`;
    const maxWidth = width - SIDE_PAD * 2 - 32;
    const rows = wrap(ctx, line, maxWidth);
    const boxH = Math.max(BOX_HEIGHT, 34 + rows.length * 22);
    const boxY = height - bar - boxH - 24;

    ctx.globalAlpha = slide;
    ctx.fillStyle = 'rgba(12,14,20,0.82)';
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(SIDE_PAD, boxY, width - SIDE_PAD * 2, boxH, 8);
    ctx.fill();
    ctx.stroke();

    let textY = boxY + 30;
    if (scene.speaker) {
      ctx.fillStyle = '#ffd479';
      ctx.font = `bold 14px ${font}`;
      ctx.textAlign = 'left';
      ctx.fillText(engine.t(scene.speaker), SIDE_PAD + 16, textY);
      textY += 22;
    }

    ctx.fillStyle = '#e8e8ea';
    ctx.font = `16px ${font}`;
    ctx.textAlign = 'left';
    for (const row of rows) {
      ctx.fillText(engine.t(row), SIDE_PAD + 16, textY);
      textY += 22;
    }

    if (scene.auto <= 0) {
      ctx.fillStyle = 'rgba(232,232,234,0.45)';
      ctx.font = `12px ${font}`;
      ctx.textAlign = 'right';
      ctx.fillText(
        engine.t('click or Enter'),
        width - SIDE_PAD - 16,
        boxY + boxH - 10,
      );
    }
  }

  ctx.restore();
}, engine.OverlayLayer.hud + 1);

engine.i18n({
  pt: { 'click or Enter': 'clique ou Enter' },
});
