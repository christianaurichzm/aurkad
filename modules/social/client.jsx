// @ts-check
// Social module, client entry: friends with an online dot, and the people
// whose chat this player does not see.

// Translations keyed by the English text; components use engine.useT().
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

const { useState } = React;
const ui = engine.ui;
const send = engine.sendServerEvent;

const row = { display: 'flex', gap: 6 };
const COLOR = {
  online: 'var(--color-success)',
  offline: 'var(--color-text-muted)',
};

// The module's state lives here, outside React: the server and the Actions
// menu change it, and every change redraws.
let state = { friends: [], ignored: [], maxFriends: 0, maxIgnored: 0 };
let tab = 'friends';
let shown = false;

function draw() {
  engine.render(shown && <SocialWindow s={state} />);
}

function toggle() {
  shown = !shown;
  draw();
}

function pick(id) {
  tab = id;
  draw();
}

function SocialWindow({ s }) {
  const t = engine.useT();
  // One field for both lists, held here so it outlives a tab switch and every
  // redraw the server causes.
  const [name, setName] = useState('');
  const friends = tab === 'friends';
  const online = s.friends.filter((f) => f.online).length;
  const empty = (friends ? s.friends : s.ignored).length === 0;
  const add = () => {
    const target = name.trim();
    if (!target) return;
    send(friends ? 'social:friendAdd' : 'social:ignoreAdd', { name: target });
    setName('');
  };
  return (
    <ui.Window
      title={
        friends
          ? t('Friends ({online}/{total} online)', {
              online,
              total: s.friends.length,
            })
          : t('Ignored')
      }
      onClose={toggle}
    >
      <div style={row}>
        <TabButton id="friends" label={t('Friends')} />
        <TabButton id="ignored" label={t('Ignored')} />
      </div>
      {empty ? (
        <div
          style={{
            fontSize: 12,
            color: 'var(--color-text-muted)',
            padding: '8px 0',
          }}
        >
          {t(friends ? 'No friends yet.' : 'Nobody ignored.')}
        </div>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            maxHeight: 240,
            overflowY: 'auto',
          }}
        >
          {friends
            ? s.friends.map((f) => (
                <Entry
                  key={f.name}
                  label={f.name}
                  status={f.online ? 'online' : 'offline'}
                  onRemove={() => send('social:friendRemove', { name: f.name })}
                />
              ))
            : s.ignored.map((n) => (
                <Entry
                  key={n}
                  label={n}
                  onRemove={() => send('social:ignoreRemove', { name: n })}
                />
              ))}
        </ul>
      )}
      <div style={row}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder={t('Player name')}
          style={{ flex: 1 }}
        />
        <button
          type="button"
          className="button-primary"
          disabled={!name.trim()}
          onClick={add}
        >
          {t('Add')}
        </button>
      </div>
    </ui.Window>
  );
}

function TabButton({ id, label }) {
  const active = tab === id;
  return (
    <button
      type="button"
      aria-pressed={active}
      style={active ? { borderColor: 'var(--color-primary)' } : undefined}
      onClick={() => pick(id)}
    >
      {label}
    </button>
  );
}

// A friend carries a status; an ignored name has none and reads as offline.
/** @param {{ label: string, status?: string, onRemove: () => void }} props */
function Entry({ label, status, onRemove }) {
  const t = engine.useT();
  const color = COLOR[status || 'offline'];
  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '5px 0',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: color,
          flex: '0 0 auto',
        }}
      />
      <span style={{ flex: 1, fontSize: 13 }}>{label}</span>
      {status && <span style={{ fontSize: 11, color }}>{t(status)}</span>}
      <button type="button" className="button-danger" onClick={onRemove}>
        {t('Remove')}
      </button>
    </li>
  );
}

ui.actionButton('Social', toggle, 'n', 'friends', 90);

engine.onServerEvent('social:update', (payload) => {
  if (!payload) return;
  state = payload;
  draw();
});

// Clicking a player on the canvas: the two things this module is for.
engine.registerPlayerAction('Add friend', (name) =>
  send('social:friendAdd', { name }),
);
engine.registerPlayerAction('Ignore', (name) =>
  send('social:ignoreAdd', { name }),
);

send('social:request');
