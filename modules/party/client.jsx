// @ts-check
// Party module, client entry: the Party button (P) opens the members with
// their health, or a create and invite form for a solo player.
// party:update arrives on every change and party:invite on an invite.

// Translations keyed by the English text; components use engine.useT().
engine.i18n({
  pt: {
    Party: 'Grupo',
    "You're not in a party.": 'Você não está em um grupo.',
    'Fight together and share experience.':
      'Lutem juntos e compartilhem experiência.',
    'Stay together to share experience.':
      'Fiquem próximos para compartilhar experiência.',
    'Create party': 'Criar grupo',
    'Invite a player': 'Convide um jogador',
    Invite: 'Convidar',
    'Party is full.': 'O grupo está cheio.',
    'Only the leader can invite.': 'Só o líder pode convidar.',
    'Party members': 'Membros do grupo',
    'Leave party': 'Sair do grupo',
    Accept: 'Aceitar',
    Decline: 'Recusar',
    'Invite to Party': 'Convidar para o grupo',
    'Party invite from {player}': 'Convite de grupo de {player}',
    'Join to fight together and share experience.':
      'Entre para lutar junto e compartilhar experiência.',
    Leader: 'Líder',
    'Lv {level}': 'Nv {level}',
    '{health}/{max} HP': '{health}/{max} PV',
    'Out of sight': 'Fora de vista',
    "{player}'s health": 'Vida de {player}',
  },
});

const { useEffect, useState } = React;
const ui = engine.ui;

// The module's state lives here, outside React: the server and the Actions
// menu change it, and every change redraws.
let state = null; // null = solo, { leader, members, maxMembers } = in party
let shown = false;
let invites = []; // { from }, waiting for an answer
// What the server answered the last thing the window asked for.
let said = '';

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

function send(channel, payload) {
  said = '';
  engine.sendServerEvent(channel, payload);
}

function toggle() {
  shown = !shown;
  said = '';
  draw();
}

function dismiss(invite) {
  invites = invites.filter((i) => i !== invite);
  draw();
}

// The party sends names only; health and level come from the world this
// client sees, so a member out of view has no bar until back in it.
function seen(name) {
  const me = engine.getPlayer();
  if (me && me.name === name) return me;
  const players = engine.getGameState()?.players ?? {};
  return Object.values(players).find((p) => p.name === name);
}

function PartyWindow({ party }) {
  const t = engine.useT();
  return (
    <ui.Window
      title={t('Party')}
      counter={
        party ? `${party.members.length}/${party.maxMembers}` : undefined
      }
      width="narrow"
      anchor="right"
      onClose={toggle}
      footer={
        party && (
          <div className="window-actions">
            <button
              type="button"
              className="button-danger"
              style={{ flex: 1 }}
              onClick={() => send('party:leave')}
            >
              {t('Leave party')}
            </button>
          </div>
        )
      }
    >
      {party ? <Members party={party} /> : <Solo />}
      {said && (
        <p className="window-label" role="status">
          {said}
        </p>
      )}
    </ui.Window>
  );
}

function Solo() {
  const t = engine.useT();
  return (
    <>
      <ui.EmptyState
        icon="party"
        title={t("You're not in a party.")}
        hint={t('Fight together and share experience.')}
      />
      <button
        type="button"
        className="button-primary"
        onClick={() => send('party:create')}
      >
        {t('Create party')}
      </button>
      <InviteRow />
    </>
  );
}

function InviteRow() {
  const t = engine.useT();
  const [name, setName] = useState('');
  const invite = (e) => {
    e.preventDefault();
    const target = name.trim();
    if (!target) return;
    send('party:invite', { name: target });
    setName('');
  };
  return (
    <form className="window-field" onSubmit={invite}>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('Invite a player')}
        aria-label={t('Invite a player')}
      />
      <button type="submit" disabled={!name.trim()}>
        {t('Invite')}
      </button>
    </form>
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
  const me = engine.getPlayer()?.name;
  // The leader first: the one the party is named after, and who invites.
  const order = [
    party.leader,
    ...party.members.filter((m) => m !== party.leader),
  ];
  return (
    <>
      <ul className="list" aria-label={t('Party members')}>
        {order.map((name) => (
          <MemberRow
            key={name}
            name={name}
            self={name === me}
            isLeader={name === party.leader}
          />
        ))}
      </ul>
      {party.members.length >= party.maxMembers ? (
        <span className="window-label">{t('Party is full.')}</span>
      ) : me === party.leader ? (
        <InviteRow />
      ) : (
        <span className="window-label">{t('Only the leader can invite.')}</span>
      )}
      {party.members.length > 1 && (
        <span className="window-label">
          {t('Stay together to share experience.')}
        </span>
      )}
    </>
  );
}

function MemberRow({ name, self, isLeader }) {
  const t = engine.useT();
  const p = seen(name);
  const share = p ? Math.max(0, Math.min(1, p.health / p.maxHealth)) : 0;
  return (
    <li
      className="list-row"
      data-self={self || undefined}
      data-dim={p ? undefined : true}
    >
      <span className="avatar" aria-hidden="true">
        {name[0]}
      </span>
      <span className="list-row-text">
        <b>
          {name}
          {isLeader && <span className="tag">{t('Leader')}</span>}
        </b>
        <small>
          {p
            ? `${t('Lv {level}', { level: p.level })} · ${t(
                '{health}/{max} HP',
                { health: Math.round(p.health), max: p.maxHealth },
              )}`
            : t('Out of sight')}
        </small>
        {p && (
          <span
            className="meter"
            data-tone={share < 0.35 ? 'low' : 'health'}
            role="meter"
            aria-label={t("{player}'s health", { player: name })}
            aria-valuemin={0}
            aria-valuemax={p.maxHealth}
            aria-valuenow={Math.round(p.health)}
          >
            <span style={{ width: `${share * 100}%` }} />
          </span>
        )}
      </span>
    </li>
  );
}

function InviteWindow({ invite }) {
  const t = engine.useT();
  const { from } = invite;
  return (
    <ui.Window
      title={t('Party invite from {player}', { player: from })}
      width="narrow"
      onClose={() => dismiss(invite)}
      footer={
        <div className="window-actions">
          <button
            type="button"
            className="button-primary"
            onClick={() => {
              send('party:accept', { leader: from });
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
      <p>{t('Join to fight together and share experience.')}</p>
    </ui.Window>
  );
}

ui.actionButton('Party', toggle, 'p', 'party', 50);

engine.onServerEvent('party:update', (data) => {
  const joined =
    data?.members?.length > 1 &&
    (state?.members?.length ?? 0) < data.members.length;
  state = data;
  if (joined) shown = true;
  draw();
});

engine.onServerEvent('party:result', (result) => {
  said = String(result?.message ?? '');
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

engine.sendServerEvent('party:request');
