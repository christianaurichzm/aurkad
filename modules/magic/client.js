// Magic module, client entry: a spell hotbar (engine.ui) with mana and
// castable spells, a click casting through the spell:cast custom action.
// It redraws on magic:update and on a timer to keep cooldowns current.

const ui = engine.ui;
const panel = ui.panel({ title: 'Spells', anchor: 'bottom-right' });

let state = null;

function render() {
  if (!state) {
    panel.setBody(document.createTextNode('…'));
    return;
  }
  const mana = document.createElement('div');
  mana.textContent = `Mana: ${Math.round(state.mana)}/${state.manaMax}`;

  const now = Date.now();
  const buttons = state.spells.map((s) => {
    const onCooldown = s.readyAt > now;
    const tooPoor = state.mana < s.cost;
    const b = ui.button(`${s.name} (${s.cost})`, () => {
      if (!onCooldown && !tooPoor) engine.sendServerEvent('spell:cast', { id: s.id });
    });
    if (onCooldown || tooPoor) {
      b.disabled = true;
      b.style.opacity = '0.5';
    }
    return b;
  });

  panel.setBody(mana, ui.column(...buttons));
}

engine.onServerEvent('magic:update', (s) => {
  state = s;
  render();
});

// Keep cooldown/mana gating visually fresh between server pushes.
setInterval(render, 500);

engine.sendServerEvent('magic:request');
