// @ts-check
// Social module, client entry: friends with an online dot, and the people
// whose chat this player does not see.

// Translations keyed by the English text; components use engine.useT().
engine.i18n({
  pt: {
    Social: 'Social',
    Friends: 'Amigos',
    Ignored: 'Ignorados',
    'Friends lists': 'Listas de amigos',
    '{online}/{total} online': '{online}/{total} online',
    "Friend's name": 'Nome do amigo',
    'Player to ignore': 'Jogador a ignorar',
    Add: 'Adicionar',
    Remove: 'Remover',
    'Remove {player}': 'Remover {player}',
    'Stop ignoring {player}': 'Deixar de ignorar {player}',
    'Add friend': 'Adicionar amigo',
    Ignore: 'Ignorar',
    'No friends yet.': 'Nenhum amigo ainda.',
    'Add a player by name below.': 'Adicione um jogador pelo nome abaixo.',
    'Nobody is ignored.': 'Ninguém ignorado.',
    "Ignored players can't message you.":
      'Jogadores ignorados não falam com você.',
    Online: 'Online',
    Offline: 'Offline',
    'Lv {level}': 'Nv {level}',
    'Messages hidden': 'Mensagens ocultas',
  },
  es: {
    Social: 'Social',
    Friends: 'Amigos',
    Ignored: 'Ignorados',
    'Friends lists': 'Listas de amigos',
    '{online}/{total} online': '{online}/{total} en línea',
    "Friend's name": 'Nombre del amigo',
    'Player to ignore': 'Jugador a ignorar',
    Add: 'Añadir',
    Remove: 'Quitar',
    'Remove {player}': 'Quitar a {player}',
    'Stop ignoring {player}': 'Dejar de ignorar a {player}',
    'Add friend': 'Añadir amigo',
    Ignore: 'Ignorar',
    'No friends yet.': 'Aún no tienes amigos.',
    'Add a player by name below.': 'Añade a un jugador por su nombre abajo.',
    'Nobody is ignored.': 'No ignoras a nadie.',
    "Ignored players can't message you.":
      'Los jugadores ignorados no pueden escribirte.',
    Online: 'En línea',
    Offline: 'Fuera de línea',
    'Lv {level}': 'Nv {level}',
    'Messages hidden': 'Mensajes ocultos',
  },
});

const { useState } = React;
const ui = engine.ui;

// The module's state lives here, outside React: the server and the Actions
// menu change it, and every change redraws.
let state = { friends: [], ignored: [], maxFriends: 0, maxIgnored: 0 };
let tab = 'friends';
let shown = false;
// What the server answered the last thing the window asked for.
let said = '';

function draw() {
  engine.render(shown && <SocialWindow s={state} />);
}

function send(channel, payload) {
  said = '';
  engine.sendServerEvent(channel, payload);
}

function toggle() {
  shown = !shown;
  said = '';
  draw();
}

function pick(id) {
  tab = id;
  said = '';
  draw();
}

function SocialWindow({ s }) {
  const t = engine.useT();
  // One field for both lists, held here so it outlives a tab switch and every
  // redraw the server causes.
  const [name, setName] = useState('');
  const friends = tab === 'friends';
  // Whoever is in the game first: the ones there is something to do with.
  const listed = s.friends
    .slice()
    .sort((a, b) => Number(b.online) - Number(a.online));
  const add = (e) => {
    e.preventDefault();
    const target = name.trim();
    if (!target) return;
    send(friends ? 'social:friendAdd' : 'social:ignoreAdd', { name: target });
    setName('');
  };
  const field = t(friends ? "Friend's name" : 'Player to ignore');
  return (
    <ui.Window
      title={t('Friends')}
      counter={
        s.friends.length
          ? t('{online}/{total} online', {
              online: s.friends.filter((f) => f.online).length,
              total: s.friends.length,
            })
          : undefined
      }
      width="narrow"
      anchor="right"
      onClose={toggle}
      footer={
        <form className="window-field" onSubmit={add}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={field}
            aria-label={field}
          />
          <button type="submit" disabled={!name.trim()}>
            {t(friends ? 'Add' : 'Ignore')}
          </button>
        </form>
      }
    >
      <div
        className="window-tabs"
        role="tablist"
        aria-label={t('Friends lists')}
      >
        <Tab id="friends" label={t('Friends')} />
        <Tab id="ignored" label={t('Ignored')} />
      </div>
      {(friends ? listed : s.ignored).length === 0 ? (
        <ui.EmptyState
          icon="friends"
          title={t(friends ? 'No friends yet.' : 'Nobody is ignored.')}
          hint={t(
            friends
              ? 'Add a player by name below.'
              : "Ignored players can't message you.",
          )}
        />
      ) : (
        <ul className="list">
          {friends
            ? listed.map((f) => (
                <Entry
                  key={f.name}
                  name={f.name}
                  online={!!f.online}
                  detail={[
                    t(f.online ? 'Online' : 'Offline'),
                    f.level && t('Lv {level}', { level: f.level }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  remove={t('Remove {player}', { player: f.name })}
                  onRemove={() => send('social:friendRemove', { name: f.name })}
                />
              ))
            : s.ignored.map((n) => (
                <Entry
                  key={n}
                  name={n}
                  detail={t('Messages hidden')}
                  remove={t('Stop ignoring {player}', { player: n })}
                  onRemove={() => send('social:ignoreRemove', { name: n })}
                />
              ))}
        </ul>
      )}
      {said && (
        <p className="window-label" role="status">
          {said}
        </p>
      )}
    </ui.Window>
  );
}

function Tab({ id, label }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => pick(id)}
    >
      {label}
    </button>
  );
}

// A friend is in the game or not; an ignored name carries no such thing.
/** @param {{ name: string, online?: boolean, detail: string, remove: string, onRemove: () => void }} props */
function Entry({ name, online, detail, remove, onRemove }) {
  const t = engine.useT();
  return (
    <li className="list-row">
      <span className="avatar" data-online={online} aria-hidden="true">
        {name[0]}
      </span>
      <span className="list-row-text">
        <b>{name}</b>
        <small>{detail}</small>
      </span>
      <span className="list-row-actions">
        <button type="button" aria-label={remove} onClick={onRemove}>
          {t('Remove')}
        </button>
      </span>
    </li>
  );
}

ui.actionButton('Social', toggle, 'n', 'friends', 90);

engine.onServerEvent('social:update', (payload) => {
  if (!payload) return;
  state = payload;
  draw();
});

engine.onServerEvent('social:result', (result) => {
  said = String(result?.message ?? '');
  draw();
});

// Clicking a player on the canvas: the two things this module is for.
engine.registerPlayerAction('Add friend', (name) =>
  send('social:friendAdd', { name }),
);
engine.registerPlayerAction('Ignore', (name) =>
  send('social:ignoreAdd', { name }),
);

engine.sendServerEvent('social:request');
