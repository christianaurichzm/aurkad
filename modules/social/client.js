// @ts-check
// Social module, client entry: one panel with two lists, friends with an
// online dot and the people whose chat this player is not shown.

engine.i18n({
  pt: {
    Social: 'Social',
    Friends: 'Amigos',
    Ignored: 'Ignorados',
    'Player name': 'Nome do jogador',
    Add: 'Adicionar',
    Remove: 'Remover',
    'Add friend': 'Adicionar amigo',
    Ignore: 'Ignorar',
    'No friends yet.': 'Nenhum amigo ainda.',
    'Nobody ignored.': 'Ninguém ignorado.',
    online: 'online',
    offline: 'offline',
    'Friends ({online}/{total} online)': 'Amigos ({online}/{total} online)',
  },
});

const TEXT = 'var(--color-text)';
const MUTED = 'var(--color-text-muted)';
const LINE = 'var(--color-border)';
const ONLINE = '#2ecc40';
const OFFLINE = '#999999';

const ui = engine.ui;
const panel = ui.panel({ title: 'Social' });
ui.actionButton('Social', () => panel.toggle(), 'n');

let state = { friends: [], ignored: [], maxFriends: 0, maxIgnored: 0 };
let tab = 'friends';

const DOT = { online: ONLINE, offline: OFFLINE };

function row(label, sub, subColor, onRemove) {
  const line = document.createElement('div');
  line.style.cssText =
    'display:flex;align-items:center;gap:8px;padding:5px 0;' +
    `border-bottom:1px solid ${LINE};`;

  const dot = document.createElement('span');
  dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${subColor};flex:0 0 auto;`;

  const name = document.createElement('span');
  name.textContent = label;
  name.style.cssText = `flex:1;font:13px sans-serif;color:${TEXT};`;

  const note = document.createElement('span');
  note.textContent = engine.t(sub);
  note.style.cssText = `font:11px sans-serif;color:${subColor};`;

  line.append(dot, name, note, ui.button('Remove', onRemove));
  return line;
}

function tabButton(id, label) {
  const b = ui.button(label, () => {
    tab = id;
    render();
  });
  if (tab === id) b.style.outline = `2px solid ${TEXT}`;
  return b;
}

function render() {
  const list = document.createElement('div');
  list.style.cssText = 'max-height:240px;overflow-y:auto;';

  if (tab === 'friends') {
    if (state.friends.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = engine.t('No friends yet.');
      empty.style.cssText = `font:12px sans-serif;color:${MUTED};padding:8px 0;`;
      list.append(empty);
    }
    for (const friend of state.friends) {
      const status = friend.online ? 'online' : 'offline';
      list.append(
        row(friend.name, status, DOT[status], () =>
          engine.sendServerEvent('social:friendRemove', { name: friend.name }),
        ),
      );
    }
  } else {
    if (state.ignored.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = engine.t('Nobody ignored.');
      empty.style.cssText = `font:12px sans-serif;color:${MUTED};padding:8px 0;`;
      list.append(empty);
    }
    for (const name of state.ignored) {
      list.append(
        row(name, '', DOT.offline, () =>
          engine.sendServerEvent('social:ignoreRemove', { name }),
        ),
      );
    }
  }

  const input = ui.input('Player name');
  const add = ui.button('Add', () => {
    const name = input.value.trim();
    if (!name) return;
    engine.sendServerEvent(
      tab === 'friends' ? 'social:friendAdd' : 'social:ignoreAdd',
      { name },
    );
    input.value = '';
  });

  const online = state.friends.filter((f) => f.online).length;
  panel.setTitle(
    tab === 'friends'
      ? engine.t('Friends ({online}/{total} online)', {
          online,
          total: state.friends.length,
        })
      : engine.t('Ignored'),
  );
  panel.setBody(
    ui.row(tabButton('friends', 'Friends'), tabButton('ignored', 'Ignored')),
    list,
    ui.row(input, add),
  );
}

engine.onServerEvent('social:update', (payload) => {
  if (!payload) return;
  state = payload;
  render();
});

// Clicking a player on the canvas: the two things this module is for.
engine.registerPlayerAction('Add friend', (name) =>
  engine.sendServerEvent('social:friendAdd', { name }),
);
engine.registerPlayerAction('Ignore', (name) =>
  engine.sendServerEvent('social:ignoreAdd', { name }),
);

engine.sendServerEvent('social:request');
render();
