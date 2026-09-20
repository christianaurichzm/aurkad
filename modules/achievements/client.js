// @ts-check
// Achievements module, client entry: a panel with one row per definition
// and a toast when one is earned.

engine.i18n({
  pt: {
    Achievements: 'Conquistas',
    'Achievements ({earned}/{total})': 'Conquistas ({earned}/{total})',
    'Nothing defined yet.': 'Nada definido ainda.',
    'Achievement unlocked': 'Conquista desbloqueada',
  },
});

const TEXT = 'var(--color-text)';
const MUTED = 'var(--color-text-muted)';
const LINE = 'var(--color-border)';
const GOLD = 'var(--color-warning)';
const FILL = 'var(--color-success)';

const ui = engine.ui;
const panel = ui.panel({ title: 'Achievements' });
ui.actionButton('Achievements', () => panel.toggle(), 'k');

let state = { earned: [], all: [] };

function achievementRow(entry, earned) {
  const card = document.createElement('div');
  card.style.cssText =
    `padding:6px 0;border-bottom:1px solid ${LINE};opacity:` +
    (earned ? '1' : '0.65') +
    ';';

  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;gap:6px;';

  const mark = document.createElement('span');
  mark.textContent = earned ? '★' : '☆';
  mark.style.cssText = `color:${earned ? GOLD : MUTED};font-size:14px;`;

  const name = document.createElement('span');
  name.textContent = engine.t(entry.name);
  name.style.cssText = `flex:1;font:bold 13px sans-serif;color:${TEXT};`;

  head.append(mark, name);
  card.append(head);

  if (entry.description) {
    const desc = document.createElement('div');
    desc.textContent = engine.t(entry.description);
    desc.style.cssText = `font:11px sans-serif;color:${MUTED};margin-left:20px;`;
    card.append(desc);
  }

  // A locked one shows how far along it is; an earned one has nothing left to
  // say, and a full bar under a star reads as a second, contradictory state.
  if (!earned && entry.target > 1) {
    const track = document.createElement('div');
    track.style.cssText = `height:4px;background:${LINE};border-radius:2px;margin:4px 0 0 20px;`;
    const fill = document.createElement('div');
    const pct = Math.round((entry.progress / entry.target) * 100);
    fill.style.cssText = `height:100%;width:${pct}%;background:${FILL};border-radius:2px;`;
    track.append(fill);

    const count = document.createElement('div');
    count.textContent = `${entry.progress}/${entry.target}`;
    count.style.cssText = `font:10px sans-serif;color:${MUTED};margin-left:20px;text-align:right;`;
    card.append(track, count);
  }

  return card;
}

function render() {
  const list = document.createElement('div');
  list.style.cssText = 'max-height:280px;overflow-y:auto;';

  if (state.all.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = engine.t('Nothing defined yet.');
    empty.style.cssText = `font:12px sans-serif;color:${MUTED};padding:8px 0;`;
    list.append(empty);
  }

  // Earned first: the list is a trophy case before it is a to-do list.
  const rows = state.all.slice().sort((a, b) => {
    const ea = state.earned.includes(a.id) ? 0 : 1;
    const eb = state.earned.includes(b.id) ? 0 : 1;
    return ea - eb;
  });
  for (const entry of rows)
    list.append(achievementRow(entry, state.earned.includes(entry.id)));

  panel.setTitle(
    engine.t('Achievements ({earned}/{total})', {
      earned: state.earned.length,
      total: state.all.length,
    }),
  );
  panel.setBody(list);
}

function toast(entry) {
  const el = document.createElement('div');
  el.style.cssText =
    'position:absolute;left:50%;top:14%;transform:translateX(-50%);' +
    'background:var(--color-surface);border:1px solid var(--color-warning);border-radius:8px;' +
    'padding:10px 18px;text-align:center;pointer-events:none;z-index:40;' +
    'transition:opacity .4s;';

  const head = document.createElement('div');
  head.textContent = '★ ' + engine.t('Achievement unlocked');
  head.style.cssText =
    'font:bold 11px sans-serif;color:var(--color-warning);letter-spacing:1px;';

  const name = document.createElement('div');
  name.textContent = engine.t(entry.name);
  name.style.cssText =
    'font:bold 15px sans-serif;color:var(--color-text);margin-top:2px;';

  el.append(head, name);
  engine.mount().append(el);
  setTimeout(() => {
    el.style.opacity = '0';
  }, 2600);
  setTimeout(() => el.remove(), 3100);
}

engine.onServerEvent('achievements:update', (payload) => {
  if (!payload) return;
  state = payload;
  render();
});

engine.onServerEvent('achievements:earned', (payload) => {
  if (payload && payload.name) toast(payload);
});

engine.sendServerEvent('achievements:request');
render();
