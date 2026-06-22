// Archery module, client entry. R shoots and the engine's projectile
// renderer draws the arrow (it listens on projectile:fire), so this only
// sends the action.

window.addEventListener('keydown', (e) => {
  if (e.key !== 'r' && e.key !== 'R') return;
  if (e.repeat) return;
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return; // typing
  engine.sendServerEvent('shoot');
});
