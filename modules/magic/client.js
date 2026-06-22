// Magic module, client entry. A Spells button in the Actions menu opens a
// panel with mana and castable spells, and a click casts one. It redraws
// on magic:update and on a timer so cooldown and mana stay current.

const ui = engine.ui;
const panel = ui.panel({ title: 'Spells' });
ui.actionButton('Spells', () => panel.toggle());

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

// Keep cooldown/mana gating fresh between server pushes.
setInterval(render, 500);

engine.sendServerEvent('magic:request');
