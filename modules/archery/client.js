// Archery module, client entry. R shoots; a panel (key Q) lists the arrow
// types, a click equips one, and the equipped arrow shows in the HUD below
// the action buttons.

const ui = engine.ui;
const panel = ui.panel({ title: 'Arrows' });
ui.actionButton('Arrows', () => panel.toggle(), 'q');

let state = null; // { equipped, arrows[] }

function render() {
  if (!state) { panel.setBody(document.createTextNode('...')); return; }

  const rows = state.arrows.map((a) => {
    const isEquipped = state.equipped && state.equipped.id === a.id;
    const btn = ui.button(
      (isEquipped ? '[x] ' : '') + a.name + ' (dmg ' + a.damage + ')',
      () => {
        if (isEquipped) {
          engine.sendServerEvent('archery:equip', { id: null });
        } else {
          engine.sendServerEvent('archery:equip', { id: a.id });
        }
      },
    );
    if (isEquipped) btn.style.background = '#1a6b3a';
    return btn;
  });

  const none = ui.button(
    (!state.equipped ? '[x] ' : '') + 'No arrow (use default power)',
    () => engine.sendServerEvent('archery:equip', { id: null }),
  );
  if (!state.equipped) none.style.background = '#444';

  panel.setBody(none, ...rows);
}

engine.onServerEvent('archery:state', (s) => {
  state = s;
  render();
});

window.addEventListener('keydown', (e) => {
  if (e.key !== 'r' && e.key !== 'R') return;
  if (e.repeat) return;
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
  engine.sendServerEvent('shoot');
});

engine.sendServerEvent('archery:request');
