// @ts-check
// Magic module, client entry. A Spells button in the Actions menu opens a
// panel with mana and castable spells; a click or the spell's hotkey (F1,
// F2, …) casts it. It redraws on magic:update and on a timer so cooldown
// and mana stay current.

const ui = engine.ui;
const panel = ui.panel({ title: "Spells" });
ui.actionButton("Spells", () => panel.toggle(), "s"); // S opens/closes

let state = null;

// Cast only when off cooldown and affordable: the one gate the panel
// buttons and the F-key hotkeys share.
function tryCast(spell) {
  if (!spell) return;
  if (spell.readyAt > Date.now()) return; // on cooldown
  if (state.mana < spell.cost) return; // not enough mana
  engine.sendServerEvent("spell:cast", { id: spell.id });
}

function render() {
  if (!state) {
    panel.setBody(document.createTextNode("…"));
    return;
  }
  const mana = document.createElement("div");
  mana.textContent = `Mana: ${Math.round(state.mana)}/${state.manaMax}`;

  const now = Date.now();
  const buttons = state.spells.map((s, i) => {
    const onCooldown = s.readyAt > now;
    const tooPoor = state.mana < s.cost;
    const b = ui.button(`F${i + 1} · ${s.name} (${s.cost})`, () => tryCast(s));
    if (onCooldown || tooPoor) {
      b.disabled = true;
      b.style.opacity = "0.5";
    }
    return b;
  });

  panel.setBody(mana, ui.column(...buttons));
}

// Hotkeys: F1 casts the first spell, F2 the second, and so on. Ignored while
// typing in a field. Works whether or not the panel is open.
window.addEventListener("keydown", (e) => {
  const m = /^F(\d+)$/.exec(e.key);
  if (!m || !state) return;
  const a = document.activeElement;
  if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA")) return; // typing
  const spell = state.spells[Number(m[1]) - 1];
  if (!spell) return;
  e.preventDefault();
  tryCast(spell);
});

engine.onServerEvent("magic:update", (s) => {
  state = s;
  render();
});

// Keep cooldown/mana gating fresh between server pushes.
setInterval(render, 500);

engine.sendServerEvent("magic:request");
