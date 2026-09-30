// @ts-check
// Magic module, client entry. A Spells button in the Actions menu opens a
// window with mana and castable spells; a click or the spell's hotkey (F1,
// F2, …) casts it. It redraws on magic:update and on a timer so cooldown
// and mana stay current.
//
// The hotkeys work with the window closed, which is how the game is played,
// so the hotbar below always draws the same state on the canvas.

// Translations keyed by the English text; components use engine.useT().
// Spell names are content and stay in the operator's language.
engine.i18n({
  pt: {
    Spells: 'Magias',
    'Mana: {mana}/{max}': 'Mana: {mana}/{max}',
  },
});

const ui = engine.ui;

let state = null;
let shown = false;

function draw() {
  engine.render(shown && <SpellsWindow s={state} />);
}

function toggle() {
  shown = !shown;
  draw();
}

ui.actionButton('Spells', toggle, 's', 'spellbook'); // S opens/closes

// Cast only when off cooldown and affordable: the one gate the window
// buttons and the F-key hotkeys share.
function tryCast(spell) {
  if (!spell) return;
  if (spell.readyAt > Date.now()) return; // on cooldown
  if (state.mana < spell.cost) return; // not enough mana
  engine.sendServerEvent('spell:cast', { id: spell.id });
}

function SpellsWindow({ s }) {
  const t = engine.useT();
  // Cooldowns end between server pushes, so the window redraws on a timer.
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);

  const now = Date.now();
  return (
    <ui.Window title={t('Spells')} onClose={toggle}>
      {s ? (
        <>
          <div>
            {t('Mana: {mana}/{max}', {
              mana: Math.round(s.mana),
              max: s.manaMax,
            })}
          </div>
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            {s.spells.map((spell, i) => (
              <li key={spell.id}>
                <button
                  type="button"
                  style={{ width: '100%' }}
                  disabled={spell.readyAt > now || s.mana < spell.cost}
                  onClick={() => tryCast(spell)}
                >
                  {`F${i + 1} · ${spell.name} (${spell.cost})`}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        '…'
      )}
    </ui.Window>
  );
}

// Hotkeys: F1 casts the first spell, F2 the second, and so on. Ignored while
// typing in a field. Works whether or not the window is open.
window.addEventListener('keydown', (e) => {
  const m = /^F(\d+)$/.exec(e.key);
  if (!m || !state) return;
  if (e.defaultPrevented || e.repeat || ui.isInputActive()) return;
  const spell = state.spells[Number(m[1]) - 1];
  if (!spell) return;
  e.preventDefault();
  tryCast(spell);
});

engine.onServerEvent('magic:update', (s) => {
  state = s;
  draw();
});

engine.sendServerEvent('magic:request');

// ─── HOTBAR ──────────────────────────────────────────────────────────────────
// Slots along the bottom of the screen: key, name, cost, and the cooldown
// as a shutter wiping downward as the spell comes back. Read-only, as
// casting is the F-keys and the window, so there is no hit-testing here.

const SLOT = 128;
const HEIGHT = 72;
const GAP = 6;
const BOTTOM = 12;
const HOTBAR_COLORS = {
  slot: 'rgba(12,16,24,0.90)',
  slotReady: 'rgba(56,189,248,0.9)',
  // A spell aimed at friends (self, party, guild) reads green and carries a
  // cross, so the kinds differ without relying on colour alone.
  slotReadySelf: 'rgba(74,222,128,0.9)',
  selfMark: '#4ade80',
  slotBlocked: 'rgba(120,130,150,0.45)',
  shutter: 'rgba(4,8,16,0.45)',
  text: '#e5edff',
  dim: '#aebbd2',
  cost: '#7dd3fc',
};

function drawSlot(ctx, x, y, width, spell, index, now, mana) {
  const remaining = Math.max(0, spell.readyAt - now);
  const total = spell.cooldownMs || 0;
  const tooPoor = mana < spell.cost;
  const ready = remaining <= 0 && !tooPoor;

  ctx.fillStyle = HOTBAR_COLORS.slot;
  ctx.fillRect(x, y, width, HEIGHT);
  ctx.strokeStyle = ready
    ? spell.friendly
      ? HOTBAR_COLORS.slotReadySelf
      : HOTBAR_COLORS.slotReady
    : HOTBAR_COLORS.slotBlocked;
  ctx.lineWidth = ready ? 2 : 1;
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, HEIGHT - 1);

  // The covered part is what is still owed. With no declared duration there
  // is no fraction to draw, so the slot stays shuttered until it is ready.
  if (remaining > 0) {
    const left = total > 0 ? Math.min(1, remaining / total) : 1;
    ctx.fillStyle = HOTBAR_COLORS.shutter;
    ctx.fillRect(x, y, width, HEIGHT * left);
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = HOTBAR_COLORS.text;
  ctx.font = 'bold 14px monospace';
  ctx.fillText(`F${index + 1}`, x + 8, y + 18);
  if (spell.friendly) {
    ctx.fillStyle = HOTBAR_COLORS.selfMark;
    ctx.textAlign = 'right';
    ctx.fillText('+', x + width - 8, y + 18);
    ctx.textAlign = 'left';
  }
  ctx.fillStyle = ready ? HOTBAR_COLORS.text : HOTBAR_COLORS.dim;
  ctx.font = '14px sans-serif';
  ctx.fillText(spell.name, x + 8, y + 40, width - 16);
  ctx.font = '12px monospace';
  ctx.fillStyle = tooPoor ? HOTBAR_COLORS.dim : HOTBAR_COLORS.cost;
  ctx.fillText(`${spell.cost} MP`, x + 8, y + HEIGHT - 10);
  if (remaining > 0) {
    ctx.fillStyle = HOTBAR_COLORS.text;
    ctx.textAlign = 'right';
    const secs = remaining / 1000;
    ctx.fillText(
      secs >= 1 ? String(Math.ceil(secs)) : secs.toFixed(1),
      x + width - 8,
      y + HEIGHT - 10,
    );
    ctx.textAlign = 'left';
  }
}

engine.registerOverlay((ctx, cam) => {
  if (!state || !state.spells || !state.spells.length) return;

  const slots = state.spells.slice(0, 8);
  const slotWidth = Math.min(
    SLOT,
    (ctx.canvas.width - 24 - (slots.length - 1) * GAP) / slots.length,
  );
  const width = slots.length * slotWidth + (slots.length - 1) * GAP;

  ctx.save();
  // Screen space: the hotbar belongs to the bottom of the view, not to a place
  // in the world.
  ctx.translate(cam.x, cam.y);
  ctx.textBaseline = 'alphabetic';

  const x0 = (ctx.canvas.width - width) / 2;
  const y = ctx.canvas.height - HEIGHT - BOTTOM;
  const now = Date.now();
  slots.forEach((spell, i) => {
    drawSlot(
      ctx,
      x0 + i * (slotWidth + GAP),
      y,
      slotWidth,
      spell,
      i,
      now,
      state.mana,
    );
  });

  ctx.restore();
}, engine.OverlayLayer.hud);
