// @ts-check
// Archery: R fires the equipped ranged weapon.

window.addEventListener('keydown', (e) => {
  if (e.key !== 'r' && e.key !== 'R') return;
  if (e.repeat || engine.ui.isInputActive()) return;
  engine.sendServerEvent('shoot');
});
