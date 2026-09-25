// @ts-check
// Quest module, client entry: a tracker panel (Q) with the active quests
// and a progress bar each, completed ones in a collapsed section. Starting
// or completing a quest shows a toast and logs a chat message.

// Strings this module draws, keyed by the English itself: text handed to the
// `ui` helpers is translated for free, the rest goes through engine.t.
engine.i18n({
  pt: {
    Quests: 'Missões',
    'Quests ({count} active)': 'Missões ({count} ativas)',
    'No quests yet.': 'Nenhuma missão ainda.',
    '✓ Done': '✓ Feita',
    'Completed ({count})': 'Concluídas ({count})',
    'Quest completed: {quest}': 'Missão concluída: {quest}',
    '✓ Quest complete: {quest}': '✓ Missão concluída: {quest}',
    'Quest started: {quest}': 'Missão iniciada: {quest}',
    'New quest: {quest}': 'Nova missão: {quest}',
  },
});

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
// The first list is what the player already had when the game opened.
let listed = false;

function progressBar(progress, target) {
  const pct = target > 0 ? Math.round((progress / target) * 100) : 100;
  const wrap = document.createElement('div');
  wrap.style.cssText =
    'width:100%;height:6px;background:var(--color-surface-muted);border-radius:3px;overflow:hidden;margin-top:3px;';
  const fill = document.createElement('div');
  fill.style.cssText = `height:100%;width:${pct}%;background:var(--color-warning);border-radius:3px;transition:width .3s;`;
  wrap.appendChild(fill);
  return wrap;
}

function questCard(q) {
  const card = document.createElement('div');
  const done = q.status === 'completed';
  card.style.cssText =
    `padding:6px 8px;border-radius:4px;border:1px solid ${done ? '#2a4a2a' : 'var(--color-border)'};` +
    `background:${done ? 'var(--color-selected)' : 'var(--color-surface-muted)'};margin-bottom:4px;`;

  const header = document.createElement('div');
  header.style.cssText =
    'display:flex;justify-content:space-between;align-items:center;font-size:13px;';

  const name = document.createElement('span');
  name.textContent = q.name;
  name.style.cssText = `font-weight:bold;color:${done ? 'var(--color-success)' : 'var(--color-text)'};`;

  const badge = document.createElement('span');
  badge.style.cssText = `font-size:11px;color:${done ? 'var(--color-success)' : 'var(--color-text-muted)'};`;
  badge.textContent = done ? engine.t('✓ Done') : `${q.progress}/${q.target}`;

  header.append(name, badge);
  card.appendChild(header);

  if (q.description) {
    const desc = document.createElement('div');
    desc.textContent = q.description;
    desc.style.cssText =
      'font-size:11px;color:var(--color-text-muted);margin-top:2px;';
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
    empty.textContent = engine.t('No quests yet.');
    empty.style.cssText =
      'color:var(--color-text-muted);font-size:12px;padding:4px 0;';
    panel.setTitle('Quests');
    panel.setBody(empty);
    return;
  }

  panel.setTitle(engine.t('Quests ({count} active)', { count: active.length }));
  const nodes = [];

  for (const q of active) nodes.push(questCard(q));

  if (done.length > 0) {
    const sep = document.createElement('details');
    sep.style.cssText = 'margin-top:6px;font-size:12px;';
    const sum = document.createElement('summary');
    sum.textContent = engine.t('Completed ({count})', { count: done.length });
    sum.style.cssText =
      'cursor:pointer;color:var(--color-text-muted);user-select:none;padding:2px 0;';
    sep.appendChild(sum);
    for (const q of done) sep.appendChild(questCard(q));
    nodes.push(sep);
  }

  panel.setBody(...nodes);
}

// What finishing a quest paid, as the server describes it: `{ experience,
// items: [{ name, quantity }] }`, absent for a reward only a script knows.
function rewardLine(reward) {
  if (!reward) return '';
  const parts = [];
  if (reward.experience) parts.push(`+${reward.experience} XP`);
  for (const item of reward.items || [])
    parts.push(`+${item.quantity} ${item.name}`);
  return parts.join(' · ');
}

function toast(text, detail) {
  const el = document.createElement('div');
  el.style.cssText =
    'background:var(--color-warning);color:#000;padding:8px 18px;border-radius:6px;' +
    'font:bold 13px sans-serif;text-align:center;';
  el.textContent = text;
  if (detail) {
    const line = document.createElement('div');
    line.textContent = detail;
    line.style.cssText = 'font-weight:normal;margin-top:2px;';
    el.append(line);
  }
  engine.ui.toast(el, 3500);
}

engine.onServerEvent('quest:update', (list) => {
  if (!Array.isArray(list)) return;

  for (const q of list) {
    const was = prevStatuses[q.id];
    if (q.status === 'completed' && was === 'active') {
      engine.chat(engine.t('Quest completed: {quest}', { quest: q.name }));
      toast(
        engine.t('✓ Quest complete: {quest}', { quest: q.name }),
        rewardLine(q.reward),
      );
    } else if (listed && q.status === 'active' && !was) {
      engine.chat(engine.t('Quest started: {quest}', { quest: q.name }));
      toast(engine.t('New quest: {quest}', { quest: q.name }));
    }
  }
  listed = true;

  prevStatuses = {};
  for (const q of list) prevStatuses[q.id] = q.status;

  quests = list;
  render();
});

engine.sendServerEvent('quest:request');
render();
