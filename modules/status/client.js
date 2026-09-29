// @ts-check
// Status module, client entry: a row of status badges under the XP bar,
// so active buffs and debuffs stay visible.

const COLORS = {
  shield: '#3b82f6',
  fury: '#ef4444',
  regen: '#22c55e',
  poison: '#a855f7',
};
const DEFAULT_COLOR = '#f59e0b';

let statuses = [];
let serverTick = 0;
let bar = null;

function ensureBar() {
  if (bar) return bar;
  bar = document.createElement('div');
  bar.id = 'status-bar';
  const hud = document.getElementById('hud');
  if (hud) hud.appendChild(bar);
  else document.body.appendChild(bar);
  return bar;
}

function badge(status, tick) {
  const el = document.createElement('span');
  const ticksLeft = Math.max(0, (status.expiresAt || 0) - tick);
  const secsLeft = Math.ceil(ticksLeft / 20);
  const color = COLORS[status.id] || DEFAULT_COLOR;
  el.textContent = `${status.name || status.id}${secsLeft > 0 ? ` ${secsLeft}s` : ''}`;
  // A variable rather than the background, so a theme's rule for
  // .status-badge (or one [data-status]) still wins.
  el.className = 'status-badge';
  el.dataset.status = status.id;
  el.style.setProperty('--status-color', color);
  el.title = status.name || status.id;
  return el;
}

function render() {
  const b = ensureBar();
  b.innerHTML = '';
  // The current tick, estimated from the last push at 20 Hz (50 ms a tick).
  const estimatedTick =
    serverTick + Math.floor((Date.now() - lastPushTime) / 50);
  for (const s of statuses) b.appendChild(badge(s, estimatedTick));
}

let lastPushTime = Date.now();

engine.onServerEvent('status:update', (data) => {
  if (!data || !Array.isArray(data.statuses)) return;
  serverTick = data.tick || 0;
  lastPushTime = Date.now();
  statuses = data.statuses;
  render();
});

// Refresh countdowns without a server round-trip.
setInterval(() => {
  if (statuses.length) render();
}, 1000);

engine.sendServerEvent('status:request');
