// @ts-check
// Magic module, client entry. A Spells button in the Actions menu opens a
// panel with mana and castable spells; a click or the spell's hotkey (F1,
// F2, …) casts it. It redraws on magic:update and on a timer so cooldown
// and mana stay current.
//
// The hotkeys work with the panel closed, which is how the game is played,
// so the hotbar below always draws the same state on the canvas.

// Strings this module draws, keyed by the English itself: text handed to the
// `ui` helpers is translated for free, the rest goes through engine.t. Spell
// names are content, so they stay in the language the operator wrote them in.
engine.i18n({
  pt: {
    Spells: 'Magias',
    'Mana: {mana}/{max}': 'Mana: {mana}/{max}',
  },
});

const ui = engine.ui;
const panel = ui.panel({ title: 'Spells' });
ui.actionButton('Spells', () => panel.toggle(), 's'); // S opens/closes

let state = null;

// Cast only when off cooldown and affordable: the one gate the panel
// buttons and the F-key hotkeys share.
function tryCast(spell) {
  if (!spell) return;
  if (spell.readyAt > Date.now()) return; // on cooldown
  if (state.mana < spell.cost) return; // not enough mana
  engine.sendServerEvent('spell:cast', { id: spell.id });
}

function render() {
  if (!state) {
    panel.setBody(document.createTextNode('…'));
    return;
  }
  const mana = document.createElement('div');
  mana.textContent = engine.t('Mana: {mana}/{max}', {
    mana: Math.round(state.mana),
    max: state.manaMax,
  });

  const now = Date.now();
  const buttons = state.spells.map((s, i) => {
    const onCooldown = s.readyAt > now;
    const tooPoor = state.mana < s.cost;
    const b = ui.button(`F${i + 1} · ${s.name} (${s.cost})`, () => tryCast(s));
    if (onCooldown || tooPoor) {
      b.disabled = true;
      b.style.opacity = '0.5';
    }
    return b;
  });

  panel.setBody(mana, ui.column(...buttons));
}

// Hotkeys: F1 casts the first spell, F2 the second, and so on. Ignored while
// typing in a field. Works whether or not the panel is open.
window.addEventListener('keydown', (e) => {
  const m = /^F(\d+)$/.exec(e.key);
  if (!m || !state) return;
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return; // typing
  const spell = state.spells[Number(m[1]) - 1];
  if (!spell) return;
  e.preventDefault();
  tryCast(spell);
});

engine.onServerEvent('magic:update', (s) => {
  state = s;
  render();
});

// Keep cooldown/mana gating fresh between server pushes.
setInterval(render, 500);

engine.sendServerEvent('magic:request');

// ─── HOTBAR ──────────────────────────────────────────────────────────────────
// Slots along the bottom of the screen: key, name, cost, and the cooldown
// as a shutter wiping downward as the spell comes back. Read-only, as
// casting is the F-keys and the panel, so there is no hit-testing here.

const SLOT = 46;
const GAP = 6;
const BOTTOM = 12;
const HOTBAR_COLORS = {
  slot: 'rgba(12,16,24,0.35)',
  slotReady: 'rgba(56,189,248,0.9)',
  // A spell that acts on the caster reads green and carries a cross, so the
  // two kinds are told apart without relying on the colour alone.
  slotReadySelf: 'rgba(74,222,128,0.9)',
  selfMark: '#4ade80',
  slotBlocked: 'rgba(120,130,150,0.45)',
  shutter: 'rgba(4,8,16,0.45)',
  text: '#e5edff',
  dim: 'rgba(229,237,255,0.45)',
  cost: '#7dd3fc',
};

function drawSlot(ctx, x, y, spell, index, now, mana) {
  const remaining = Math.max(0, spell.readyAt - now);
  const total = spell.cooldownMs || 0;
  const tooPoor = mana < spell.cost;
  const ready = remaining <= 0 && !tooPoor;

  ctx.fillStyle = HOTBAR_COLORS.slot;
  ctx.fillRect(x, y, SLOT, SLOT);
  ctx.strokeStyle = ready
    ? spell.selfCast
      ? HOTBAR_COLORS.slotReadySelf
      : HOTBAR_COLORS.slotReady
    : HOTBAR_COLORS.slotBlocked;
  ctx.lineWidth = ready ? 2 : 1;
  ctx.strokeRect(x + 0.5, y + 0.5, SLOT - 1, SLOT - 1);

  if (spell.selfCast) {
    ctx.fillStyle = ready ? HOTBAR_COLORS.selfMark : HOTBAR_COLORS.dim;
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('+', x + SLOT - 4, y + 12);
    ctx.textAlign = 'left';
  }

  ctx.fillStyle = ready ? HOTBAR_COLORS.text : HOTBAR_COLORS.dim;
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`F${index + 1}`, x + 4, y + 12);
  ctx.font = '9px monospace';
  ctx.fillText(spell.name.slice(0, 7), x + 4, y + 26);
  ctx.fillStyle = tooPoor ? HOTBAR_COLORS.dim : HOTBAR_COLORS.cost;
  ctx.fillText(String(spell.cost), x + 4, y + SLOT - 6);

  if (remaining <= 0) return;

  // Wipes downward: the covered part is what is still owed. With no declared
  // duration there is nothing to draw a fraction of, so the slot just stays
  // shuttered until it is ready.
  const left = total > 0 ? Math.min(1, remaining / total) : 1;
  ctx.fillStyle = HOTBAR_COLORS.shutter;
  ctx.fillRect(x, y, SLOT, SLOT * left);

  ctx.fillStyle = HOTBAR_COLORS.text;
  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'center';
  const secs = remaining / 1000;
  ctx.fillText(
    secs >= 1 ? String(Math.ceil(secs)) : secs.toFixed(1),
    x + SLOT / 2,
    y + SLOT / 2 + 5,
  );
  ctx.textAlign = 'left';
}

engine.registerOverlay((ctx, cam) => {
  if (!state || !state.spells || !state.spells.length) return;

  const slots = state.spells.slice(0, 8);
  const width = slots.length * SLOT + (slots.length - 1) * GAP;

  ctx.save();
  // Screen space: the hotbar belongs to the bottom of the view, not to a place
  // in the world.
  ctx.translate(cam.x, cam.y);
  ctx.textBaseline = 'alphabetic';

  const x0 = (ctx.canvas.width - width) / 2;
  const y = ctx.canvas.height - SLOT - BOTTOM;
  const now = Date.now();
  slots.forEach((spell, i) => {
    drawSlot(ctx, x0 + i * (SLOT + GAP), y, spell, i, now, state.mana);
  });

  ctx.restore();
}, engine.OverlayLayer.hud);
