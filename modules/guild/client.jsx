// @ts-check
// Guild module, client entry: found or join a guild, see its members and
// use the controls a role allows. guild:invite fires on an invite.

// Translations keyed by the English text. `ui` helpers translate on their
// own; other text goes through engine.t or engine.useT().
engine.i18n({
  pt: {
    Guild: 'Guilda',
    'Found a guild': 'Fundar uma guilda',
    'Guild name': 'Nome da guilda',
    Privacy: 'Privacidade',
    Public: 'Pública',
    Private: 'Privada',
    'Anyone can join': 'Qualquer um entra',
    'Invite only': 'Só por convite',
    'Create guild': 'Criar guilda',
    'Join a public guild': 'Entrar em uma guilda pública',
    '{count} of {max} members': '{count} de {max} membros',
    Join: 'Entrar',
    'No public guilds yet.': 'Nenhuma guilda pública ainda.',
    'Found the first one above.': 'Funde a primeira acima.',
    'Public guild': 'Guilda pública',
    'Private guild': 'Guilda privada',
    '{count} online': '{count} online',
    Members: 'Membros',
    you: 'você',
    Owner: 'Dono',
    Officer: 'Oficial',
    Member: 'Membro',
    'Lv {level}': 'Nv {level}',
    Online: 'Online',
    Offline: 'Offline',
    'Invite a player by name': 'Convide um jogador pelo nome',
    Invite: 'Convidar',
    'Only officers and the owner can invite.':
      'Só oficiais e o dono podem convidar.',
    Promote: 'Promover',
    Demote: 'Rebaixar',
    Kick: 'Expulsar',
    'Promote {player}': 'Promover {player}',
    'Demote {player}': 'Rebaixar {player}',
    'Kick {player}': 'Expulsar {player}',
    'Make public': 'Tornar pública',
    'Make private': 'Tornar privada',
    'Leave guild': 'Sair da guilda',
    'Leave {guild}?': 'Sair de {guild}?',
    Leave: 'Sair',
    Stay: 'Ficar',
    Accept: 'Aceitar',
    Decline: 'Recusar',
    'Invite to Guild': 'Convidar para a guilda',
    'Guild invite: {guild}': 'Convite de guilda: {guild}',
    '{player} invited you to "{guild}"':
      '{player} convidou você para "{guild}"',
    'You were kicked from guild "{guild}".':
      'Você foi expulso da guilda "{guild}".',
    'You were kicked from "{guild}"': 'Você foi expulso de "{guild}"',
  },
});

const { useState } = React;
const ui = engine.ui;

const RANK = { owner: 0, moderator: 1, member: 2 };
const ROLE = { owner: 'Owner', moderator: 'Officer', member: 'Member' };
const section = { display: 'grid', gap: 6 };

// The module's state lives here, outside React: the server and the Actions
// menu change it, and every change redraws.
let guild = null; // what the server last sent; null = in no guild
let shown = false;
let invites = []; // { guildName, from }, waiting for an answer
// Public guilds, asked for while in none:
// { guilds: [{ name, members }], maxMembers }.
let joinable = { guilds: [], maxMembers: 0 };
// What the server answered the last thing the window asked for.
let said = '';

function draw() {
  engine.render(
    <>
      {shown && <GuildWindow g={guild} />}
      {invites.map((invite) => (
        <InviteWindow key={invite.guildName} invite={invite} />
      ))}
    </>,
  );
}

function send(channel, payload) {
  said = '';
  engine.sendServerEvent(channel, payload);
}

function toggle() {
  shown = !shown;
  said = '';
  draw();
  if (shown && !guild) engine.sendServerEvent('guild:list');
}

function dismiss(invite) {
  invites = invites.filter((i) => i !== invite);
  draw();
}

function Said() {
  return (
    said && (
      <p className="window-label" role="status">
        {said}
      </p>
    )
  );
}

function GuildWindow({ g }) {
  const t = engine.useT();
  const [leaving, setLeaving] = useState(false);
  if (!g)
    return (
      <ui.Window title={t('Guild')} width="regular" onClose={toggle}>
        <NoGuild />
      </ui.Window>
    );

  const owner = g.members.find((m) => m.name === g.self)?.role === 'owner';
  return (
    <ui.Window
      title={g.name}
      counter={`${g.members.length}/${g.maxMembers}`}
      width="regular"
      onClose={toggle}
      footer={
        leaving ? (
          <div className="window-actions" role="group">
            <span style={{ flex: 1, alignSelf: 'center' }}>
              {t('Leave {guild}?', { guild: g.name })}
            </span>
            <button
              type="button"
              className="button-danger"
              onClick={() => {
                setLeaving(false);
                send('guild:leave');
              }}
            >
              {t('Leave')}
            </button>
            <button type="button" onClick={() => setLeaving(false)}>
              {t('Stay')}
            </button>
          </div>
        ) : (
          <div className="window-actions">
            {owner && (
              <button
                type="button"
                onClick={() =>
                  send('guild:privacy', {
                    privacy: g.privacy === 'private' ? 'public' : 'private',
                  })
                }
              >
                {t(g.privacy === 'private' ? 'Make public' : 'Make private')}
              </button>
            )}
            <button
              type="button"
              className="button-danger"
              style={{ marginLeft: 'auto' }}
              onClick={() => setLeaving(true)}
            >
              {t('Leave guild')}
            </button>
          </div>
        )
      }
    >
      <Members g={g} />
    </ui.Window>
  );
}

function NoGuild() {
  const t = engine.useT();
  const [name, setName] = useState('');
  const [privacy, setPrivacy] = useState('public');
  const trimmed = name.trim();
  return (
    <>
      <section style={section} aria-label={t('Found a guild')}>
        <h3 className="window-heading">{t('Found a guild')}</h3>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('Guild name')}
          aria-label={t('Guild name')}
        />
        <div className="chips" role="radiogroup" aria-label={t('Privacy')}>
          {['public', 'private'].map((kind) => (
            <button
              key={kind}
              type="button"
              role="radio"
              className="chip"
              aria-checked={privacy === kind}
              onClick={() => setPrivacy(kind)}
            >
              {t(kind === 'public' ? 'Public' : 'Private')}
              <small>
                {t(kind === 'public' ? 'Anyone can join' : 'Invite only')}
              </small>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="button-primary"
          disabled={!trimmed}
          onClick={() => send('guild:create', { name: trimmed, privacy })}
        >
          {t('Create guild')}
        </button>
        <Said />
      </section>
      <section style={section} aria-label={t('Join a public guild')}>
        <h3 className="window-heading">{t('Join a public guild')}</h3>
        {joinable.guilds.length === 0 ? (
          <ui.EmptyState
            icon="guild"
            title={t('No public guilds yet.')}
            hint={t('Found the first one above.')}
          />
        ) : (
          <ul className="list">
            {joinable.guilds.map((entry) => (
              <li key={entry.name} className="list-row">
                <span className="avatar" aria-hidden="true">
                  {entry.name[0]}
                </span>
                <span className="list-row-text">
                  <b>{entry.name}</b>
                  <small>
                    {t('{count} of {max} members', {
                      count: entry.members,
                      max: joinable.maxMembers,
                    })}
                  </small>
                </span>
                <span className="list-row-actions">
                  <button
                    type="button"
                    onClick={() => send('guild:join', { name: entry.name })}
                  >
                    {t('Join')}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Members({ g }) {
  const t = engine.useT();
  const [invitee, setInvitee] = useState('');
  const me = g.self;
  const myRole = g.members.find((m) => m.name === me)?.role;
  // By rank, and within a rank whoever is in the game first.
  const members = g.members
    .slice()
    .sort(
      (a, b) =>
        RANK[a.role] - RANK[b.role] || Number(!!b.online) - Number(!!a.online),
    );
  const invite = (e) => {
    e.preventDefault();
    const target = invitee.trim();
    if (!target) return;
    send('guild:invite', { target });
    setInvitee('');
  };
  return (
    <>
      <span className="window-label">
        {t(g.privacy === 'private' ? 'Private guild' : 'Public guild')}
        {' · '}
        {t('{count} online', {
          count: g.members.filter((m) => m.online).length,
        })}
      </span>
      <ul className="list" aria-label={t('Members')}>
        {members.map((m) => {
          const self = m.name === me;
          // The owner ranks and removes anyone; an officer removes members.
          const ranks = myRole === 'owner' && !self;
          const kicks =
            ranks || (myRole === 'moderator' && m.role === 'member' && !self);
          return (
            <li key={m.name} className="list-row" data-self={self || undefined}>
              <span
                className="avatar"
                data-online={!!m.online}
                aria-hidden="true"
              >
                {m.name[0]}
              </span>
              <span className="list-row-text">
                <b>
                  {m.name}
                  {self && <small> ({t('you')})</small>}
                </b>
                <small>
                  {[
                    t(ROLE[m.role] || 'Member'),
                    m.level && t('Lv {level}', { level: m.level }),
                    t(m.online ? 'Online' : 'Offline'),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </span>
              {kicks && (
                <span className="list-row-actions">
                  {ranks && m.role === 'member' && (
                    <button
                      type="button"
                      aria-label={t('Promote {player}', { player: m.name })}
                      onClick={() => send('guild:promote', { target: m.name })}
                    >
                      {t('Promote')}
                    </button>
                  )}
                  {ranks && m.role === 'moderator' && (
                    <button
                      type="button"
                      aria-label={t('Demote {player}', { player: m.name })}
                      onClick={() => send('guild:demote', { target: m.name })}
                    >
                      {t('Demote')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="button-danger"
                    aria-label={t('Kick {player}', { player: m.name })}
                    onClick={() => send('guild:kick', { target: m.name })}
                  >
                    {t('Kick')}
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {myRole === 'owner' || myRole === 'moderator' ? (
        <form className="window-field" onSubmit={invite}>
          <input
            type="text"
            value={invitee}
            onChange={(e) => setInvitee(e.target.value)}
            placeholder={t('Invite a player by name')}
            aria-label={t('Invite a player by name')}
          />
          <button type="submit" disabled={!invitee.trim()}>
            {t('Invite')}
          </button>
        </form>
      ) : (
        <span className="window-label">
          {t('Only officers and the owner can invite.')}
        </span>
      )}
      <Said />
    </>
  );
}

function InviteWindow({ invite }) {
  const t = engine.useT();
  const { guildName, from } = invite;
  return (
    <ui.Window
      title={t('Guild invite: {guild}', { guild: guildName })}
      width="narrow"
      anchor="right"
      onClose={() => dismiss(invite)}
      footer={
        <div className="window-actions">
          <button
            type="button"
            className="button-primary"
            onClick={() => {
              send('guild:accept', { guildName });
              dismiss(invite);
            }}
          >
            {t('Accept')}
          </button>
          <button type="button" onClick={() => dismiss(invite)}>
            {t('Decline')}
          </button>
        </div>
      }
    >
      <p>
        {t('{player} invited you to "{guild}"', {
          player: from,
          guild: guildName,
        })}
      </p>
    </ui.Window>
  );
}

ui.actionButton('Guild', toggle, 'g', 'guild', 60);

engine.onServerEvent('guild:update', (g) => {
  // Out of a guild with the window open: the list of the ones to join is due.
  if (guild && !g && shown) engine.sendServerEvent('guild:list');
  guild = g;
  draw();
});

engine.onServerEvent('guild:list', (list) => {
  if (!list || !Array.isArray(list.guilds)) return;
  joinable = list;
  draw();
});

engine.onServerEvent('guild:result', (result) => {
  said = String(result?.message ?? '');
  draw();
});

engine.onServerEvent('guild:invite', ({ guildName, from }) => {
  // A second invite to the same guild replaces the first, timer and all.
  const invite = { guildName, from };
  invites = [...invites.filter((i) => i.guildName !== guildName), invite];
  draw();
  setTimeout(() => dismiss(invite), 60_000);
});

engine.onServerEvent('guild:kicked', ({ from }) => {
  engine.chat(
    engine.t('You were kicked from guild "{guild}".', { guild: from }),
  );
  ui.notice(engine.t('You were kicked from "{guild}"', { guild: from }), {
    tone: 'danger',
    ms: 4000,
  });
});

engine.registerPlayerAction('Invite to Guild', (name) => {
  send('guild:invite', { target: name });
});

engine.sendServerEvent('guild:request');
