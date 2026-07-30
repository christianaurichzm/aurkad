// @ts-check
// Quest module, client entry: a tracker panel (Q) with the active quests
// and a progress bar each, completed ones in a collapsed section. A quest
// completing shows a toast and logs a chat message.

const ui = engine.ui;
const panel = ui.panel({ title: 'Quests' });
ui.actionButton(
  'Quests',
  () => {
    panel.toggle();
    if (panel.isOpen()) engine.sendServerEvent('quest:request');
  },
  'q',
);

let quests = []; // [{ id, name, description, progress, target, status }]
let prevStatuses = {}; // id → status, for detecting transitions

function progressBar(progress, target) {
  const pct = target > 0 ? Math.round((progress / target) * 100) : 100;
  const wrap = document.createElement('div');
  wrap.style.cssText =
    'width:100%;height:6px;background:#2a2a2a;border-radius:3px;overflow:hidden;margin-top:3px;';
  const fill = document.createElement('div');
  fill.style.cssText = `height:100%;width:${pct}%;background:#f59e0b;border-radius:3px;transition:width .3s;`;
  wrap.appendChild(fill);
  return wrap;
}

function questCard(q) {
  const card = document.createElement('div');
  const done = q.status === 'completed';
  card.style.cssText =
    `padding:6px 8px;border-radius:4px;border:1px solid ${done ? '#2a4a2a' : '#333'};` +
    `background:${done ? '#0f2a0f' : '#1a1a1a'};margin-bottom:4px;`;

  const header = document.createElement('div');
  header.style.cssText =
    'display:flex;justify-content:space-between;align-items:center;font-size:13px;';

  const name = document.createElement('span');
  name.textContent = q.name;
  name.style.cssText = `font-weight:bold;color:${done ? '#4ade80' : '#eee'};`;

  const badge = document.createElement('span');
  badge.style.cssText = `font-size:11px;color:${done ? '#4ade80' : '#aaa'};`;
  badge.textContent = done ? '✓ Done' : `${q.progress}/${q.target}`;

  header.append(name, badge);
  card.appendChild(header);

  if (q.description) {
    const desc = document.createElement('div');
    desc.textContent = q.description;
    desc.style.cssText = 'font-size:11px;color:#888;margin-top:2px;';
    card.appendChild(desc);
  }

  if (!done) card.appendChild(progressBar(q.progress, q.target));

  return card;
}

function render() {
  const active = quests.filter((q) => q.status === 'active');
  const done = quests.filter((q) => q.status === 'completed');

  if (quests.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = 'No quests yet.';
    empty.style.cssText = 'color:#888;font-size:12px;padding:4px 0;';
    panel.setTitle('Quests');
    panel.setBody(empty);
    return;
  }

  panel.setTitle(`Quests (${active.length} active)`);
  const nodes = [];

  for (const q of active) nodes.push(questCard(q));

  if (done.length > 0) {
    const sep = document.createElement('details');
    sep.style.cssText = 'margin-top:6px;font-size:12px;';
    const sum = document.createElement('summary');
    sum.textContent = `Completed (${done.length})`;
    sum.style.cssText =
      'cursor:pointer;color:#666;user-select:none;padding:2px 0;';
    sep.appendChild(sum);
    for (const q of done) sep.appendChild(questCard(q));
    nodes.push(sep);
  }

  panel.setBody(...nodes);
}

function showCompletionToast(name) {
  engine.chat(`Quest completed: ${name}`);
  const toast = document.createElement('div');
  toast.style.cssText =
    'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
    'background:#f59e0b;color:#000;padding:8px 18px;border-radius:6px;' +
    'font:bold 13px sans-serif;z-index:9999;pointer-events:none;' +
    'animation:questToastIn .25s ease;';
  toast.textContent = `✓ Quest complete: ${name}`;

  if (!document.getElementById('quest-toast-style')) {
    const style = document.createElement('style');
    style.id = 'quest-toast-style';
    style.textContent =
      '@keyframes questToastIn{from{opacity:0;transform:translateX(-50%) translateY(8px)}' +
      'to{opacity:1;transform:translateX(-50%) translateY(0)}}';
    document.head.appendChild(style);
  }

  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

engine.onServerEvent('quest:update', (list) => {
  if (!Array.isArray(list)) return;

  // Detect newly completed quests to show toasts
  for (const q of list) {
    if (q.status === 'completed' && prevStatuses[q.id] === 'active') {
      showCompletionToast(q.name);
    }
  }

  prevStatuses = {};
  for (const q of list) prevStatuses[q.id] = q.status;

  quests = list;
  render();
});

engine.sendServerEvent('quest:request');
render();
