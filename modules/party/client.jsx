// @ts-check
// Party module, client entry: the Party button (P) opens the members with
// their health, or a create and invite form for a solo player.
// party:update arrives on every change and party:invite on an invite.

// Translations keyed by the English text; components use engine.useT().
engine.i18n({
  pt: {
    Party: 'Grupo',
    'Party ready. Stay together to share experience.':
      'Grupo pronto. Fiquem próximos para compartilhar experiência.',
    'Party ({size}/{max})': 'Grupo ({size}/{max})',
    'Player name to invite': 'Nome do jogador a convidar',
    'Create Party': 'Criar grupo',
    'Invite player': 'Convidar jogador',
    Invite: 'Convidar',
    Leave: 'Sair',
    Accept: 'Aceitar',
    Decline: 'Recusar',
    'Invite to Party': 'Convidar para o grupo',
    'Party invite from {player}': 'Convite de grupo de {player}',
    'Join to fight together and share experience.':
      'Entre para lutar junto e compartilhar experiência.',
    Leader: 'Líder',
    'Level {level}': 'Nível {level}',
    'Out of sight': 'Fora de vista',
  },
});

const { useEffect, useState } = React;
const ui = engine.ui;
const send = engine.sendServerEvent;

const row = { display: 'flex', gap: 6 };

// The module's state lives here, outside React: the server and the Actions
// menu change it, and every change redraws.
let state = null; // null = solo, { leader, members, maxMembers } = in party
let shown = false;
let invites = []; // { from }, waiting for an answer

function draw() {
  engine.render(
    <>
      {shown && <PartyWindow party={state} />}
      {invites.map((invite) => (
        <InviteWindow key={invite.from} invite={invite} />
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

// The party sends names only; health and level come from the world this
// client sees, so a member out of view has an empty bar until back in it.
function seen(name) {
  const me = engine.getPlayer();
  if (me && me.name === name) return me;
  const players = engine.getGameState()?.players ?? {};
  return Object.values(players).find((p) => p.name === name);
}

const healthColor = (share) =>
  share > 0.5
    ? 'var(--color-success)'
    : share > 0.2
      ? 'var(--color-warning)'
      : 'var(--color-danger)';

function PartyWindow({ party }) {
  const t = engine.useT();
  return (
    <ui.Window
      title={
        party
          ? t('Party ({size}/{max})', {
              size: party.members.length,
              max: party.maxMembers,
            })
          : t('Party')
      }
      width={320}
      onClose={toggle}
    >
      {party ? <Members party={party} /> : <Solo />}
    </ui.Window>
  );
}

function Solo() {
  const t = engine.useT();
  return (
    <>
      <button
        type="button"
        className="button-primary"
        onClick={() => send('party:create')}
      >
        {t('Create Party')}
      </button>
      <InviteRow placeholder={t('Player name to invite')} />
    </>
  );
}

function InviteRow({ placeholder, clear = false }) {
  const t = engine.useT();
  const [name, setName] = useState('');
  const invite = () => {
    const target = name.trim();
    if (target) send('party:invite', { name: target });
    if (clear) setName('');
  };
  return (
    <div style={row}>
      <input
        style={{ flex: 1, minWidth: 0 }}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={placeholder}
      />
      <button type="button" onClick={invite}>
        {t('Invite')}
      </button>
    </div>
  );
}

function Members({ party }) {
  const t = engine.useT();
  const [, look] = useState(0);
  // Nothing is pushed for health, so the open window rereads the world a
  // few times a second.
  useEffect(() => {
    const timer = setInterval(() => look((n) => n + 1), 250);
    return () => clearInterval(timer);
  }, []);
  // The leader first: the one the party is named after, and who invites.
  const order = [
    party.leader,
    ...party.members.filter((m) => m !== party.leader),
  ];
  return (
    <>
      <p
        role="status"
        style={{
          margin: '0 0 4px',
          lineHeight: 1.4,
          fontSize: 14,
          color: 'var(--color-success)',
        }}
      >
        {party.members.length > 1
          ? t('Party ready. Stay together to share experience.')
          : ''}
      </p>
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {order.map((name) => (
          <MemberCard key={name} name={name} isLeader={name === party.leader} />
        ))}
      </ul>
      <InviteRow placeholder={t('Invite player')} clear />
      <button
        type="button"
        className="button-danger"
        onClick={() => send('party:leave')}
      >
        {t('Leave')}
      </button>
    </>
  );
}

function MemberCard({ name, isLeader }) {
  const t = engine.useT();
  const p = seen(name);
  const share = p ? Math.max(0, Math.min(1, p.health / p.maxHealth)) : 0;
  return (
    <li
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '8px 10px',
        borderRadius: 'var(--radius-control)',
        background: 'var(--color-surface-muted)',
        border: '1px solid var(--color-border)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 17 }}>{name}</span>
        <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          {p ? t('Level {level}', { level: p.level }) : ''}
        </span>
        {isLeader && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '.06em',
              textTransform: 'uppercase',
              color: 'var(--color-warning)',
            }}
          >
            {`★ ${t('Leader')}`}
          </span>
        )}
      </div>
      <div
        role="meter"
        aria-label={name}
        aria-valuenow={p ? Math.round(share * 100) : undefined}
        style={{
          position: 'relative',
          height: 16,
          borderRadius: 8,
          overflow: 'hidden',
          background: 'rgba(0,0,0,.4)',
          opacity: p ? 1 : 0.5,
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${share * 100}%`,
            transition: 'width .25s',
            background: healthColor(share),
          }}
        />
        <span
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            fontWeight: 600,
            color: '#fff',
            textShadow: '0 1px 2px #000',
          }}
        >
          {p ? `${Math.round(p.health)} / ${p.maxHealth}` : t('Out of sight')}
        </span>
      </div>
    </li>
  );
}

function InviteWindow({ invite }) {
  const t = engine.useT();
  const { from } = invite;
  const grow = { flex: 1, padding: '10px 12px', fontSize: 15, fontWeight: 600 };
  return (
    <ui.Window
      title={t('Party invite from {player}', { player: from })}
      width={300}
      onClose={() => dismiss(invite)}
    >
      <p style={{ margin: '0 0 4px', lineHeight: 1.4 }}>
        {t('Join to fight together and share experience.')}
      </p>
      <div style={row}>
        <button
          type="button"
          className="button-primary"
          style={grow}
          onClick={() => {
            send('party:accept', { leader: from });
            dismiss(invite);
          }}
        >
          {t('Accept')}
        </button>
        <button type="button" style={grow} onClick={() => dismiss(invite)}>
          {t('Decline')}
        </button>
      </div>
    </ui.Window>
  );
}

ui.actionButton('Party', toggle, 'p', 'party');

engine.onServerEvent('party:update', (data) => {
  const joined =
    data?.members?.length > 1 &&
    (state?.members?.length ?? 0) < data.members.length;
  state = data;
  if (joined) shown = true;
  draw();
});

engine.onServerEvent('party:invite', ({ from }) => {
  // A second invite from the same player replaces the first, timer and all.
  const invite = { from };
  invites = [...invites.filter((i) => i.from !== from), invite];
  draw();
  setTimeout(() => dismiss(invite), 30_000);
});

engine.registerPlayerAction('Invite to Party', (name) => {
  send('party:invite', { name });
});

send('party:request');
