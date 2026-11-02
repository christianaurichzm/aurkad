// @ts-check
// Archery: R fires the equipped ranged weapon.

window.addEventListener('keydown', (e) => {
  if (e.key !== 'r' && e.key !== 'R') return;
  if (e.defaultPrevented || e.repeat) return;
  if (e.ctrlKey || e.altKey || e.metaKey || engine.ui.isInputActive()) return;
  engine.sendServerEvent('shoot');
});
