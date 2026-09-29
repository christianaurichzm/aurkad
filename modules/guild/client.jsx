// @ts-check
// Guild module, client entry. The window lists members with their roles,
// and officers and the owner get invite, promote, demote, kick and the
// privacy toggle. guild:invite fires when someone invites this player.

// Translations keyed by the English text. `ui` helpers translate on their
// own; other text goes through engine.t or engine.useT().
engine.i18n({
  pt: {
    Guild: 'Guilda',
    'Guild name': 'Nome da guilda',
    Privacy: 'Privacidade',
    Public: 'Pública',
    Private: 'Privada',
    'Create Guild': 'Criar guilda',
    'Join Public': 'Entrar em pública',
    '🔒 Private': '🔒 Privada',
    '🌐 Public': '🌐 Pública',
    'Invite player name': 'Nome do jogador',
    Invite: 'Convidar',
    Promote: 'Promover',
    Demote: 'Rebaixar',
    Kick: 'Expulsar',
    'Make Public': 'Tornar pública',
    'Make Private': 'Tornar privada',
    'Leave Guild': 'Sair da guilda',
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
const send = engine.sendServerEvent;

const ROLE_ICON = { owner: '♛', moderator: '★', member: '•' };
const row = { display: 'flex', gap: 6 };
const small = { padding: '2px 5px', fontSize: 11 };

// The module's state lives here, outside React: the server and the Actions
// menu change it, and every change redraws.
let guild = null; // what the server last sent; null = in no guild
let shown = false;
let invites = []; // { guildName, from }, waiting for an answer

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

function toggle() {
  shown = !shown;
  draw();
}

function dismiss(invite) {
  invites = invites.filter((i) => i !== invite);
  draw();
}

function GuildWindow({ g }) {
  const t = engine.useT();
  return (
    <ui.Window
      title={g ? `${g.name} (${g.members.length})` : t('Guild')}
      onClose={toggle}
    >
      {g ? <Members g={g} /> : <NoGuild />}
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
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('Guild name')}
      />
      <select
        value={privacy}
        onChange={(e) => setPrivacy(e.target.value)}
        aria-label={t('Privacy')}
      >
        <option value="public">{t('Public')}</option>
        <option value="private">{t('Private')}</option>
      </select>
      <div style={row}>
        <button
          type="button"
          className="button-primary"
          disabled={!trimmed}
          onClick={() => send('guild:create', { name: trimmed, privacy })}
        >
          {t('Create Guild')}
        </button>
        <button
          type="button"
          disabled={!trimmed}
          onClick={() => send('guild:join', { name: trimmed })}
        >
          {t('Join Public')}
        </button>
      </div>
    </>
  );
}

function Members({ g }) {
  const t = engine.useT();
  const [invitee, setInvitee] = useState('');
  const me = g.self;
  const myRole = g.members.find((m) => m.name === me)?.role;
  const invite = () => {
    const target = invitee.trim();
    if (!target) return;
    send('guild:invite', { target });
    setInvitee('');
  };
  return (
    <>
      <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
        {t(g.privacy === 'private' ? '🔒 Private' : '🌐 Public')}
      </span>
      <ul
        style={{
          listStyle: 'none',
          margin: '6px 0',
          padding: 0,
          maxHeight: 180,
          overflowY: 'auto',
        }}
      >
        {g.members.map((m) => (
          <li
            key={m.name}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '2px 0',
              borderBottom: '1px solid var(--color-surface-muted)',
              fontSize: 13,
            }}
          >
            <span style={m.name === me ? { fontWeight: 'bold' } : undefined}>
              {ROLE_ICON[m.role] || '•'} {m.name}
            </span>
            {myRole === 'owner' && m.name !== me && (
              <span style={{ display: 'flex', gap: 3 }}>
                {m.role === 'member' && (
                  <button
                    type="button"
                    style={small}
                    title={t('Promote')}
                    aria-label={t('Promote')}
                    onClick={() => send('guild:promote', { target: m.name })}
                  >
                    ↑
                  </button>
                )}
                {m.role === 'moderator' && (
                  <button
                    type="button"
                    style={small}
                    title={t('Demote')}
                    aria-label={t('Demote')}
                    onClick={() => send('guild:demote', { target: m.name })}
                  >
                    ↓
                  </button>
                )}
                <button
                  type="button"
                  className="button-danger"
                  style={small}
                  title={t('Kick')}
                  aria-label={t('Kick')}
                  onClick={() => send('guild:kick', { target: m.name })}
                >
                  ✕
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {(myRole === 'owner' || myRole === 'moderator') && (
        <div style={row}>
          <input
            value={invitee}
            onChange={(e) => setInvitee(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && invite()}
            placeholder={t('Invite player name')}
          />
          <button type="button" onClick={invite}>
            {t('Invite')}
          </button>
        </div>
      )}
      {myRole === 'owner' && (
        <button
          type="button"
          onClick={() =>
            send('guild:privacy', {
              privacy: g.privacy === 'private' ? 'public' : 'private',
            })
          }
        >
          {t(g.privacy === 'private' ? 'Make Public' : 'Make Private')}
        </button>
      )}
      <button type="button" onClick={() => send('guild:leave')}>
        {t('Leave Guild')}
      </button>
    </>
  );
}

function InviteWindow({ invite }) {
  const t = engine.useT();
  const { guildName, from } = invite;
  return (
    <ui.Window
      title={t('Guild invite: {guild}', { guild: guildName })}
      onClose={() => dismiss(invite)}
    >
      <div>
        {t('{player} invited you to "{guild}"', {
          player: from,
          guild: guildName,
        })}
      </div>
      <div style={row}>
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
    </ui.Window>
  );
}

ui.actionButton('Guild', toggle, 'g');

engine.onServerEvent('guild:update', (g) => {
  guild = g;
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
  const el = document.createElement('div');
  el.textContent = engine.t('You were kicked from "{guild}"', { guild: from });
  el.style.cssText =
    'background:var(--color-danger);color:#fff;padding:8px 16px;' +
    'border-radius:var(--radius-control);font-weight:bold;';
  ui.toast(el, 4000);
});

engine.registerPlayerAction('Invite to Guild', (name) => {
  send('guild:invite', { target: name });
});

send('guild:request');
