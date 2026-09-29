// @ts-check
// Party module, client entry. The Party button (P) opens a panel with the
// members, or a create and invite form for a solo player. The server
// pushes party:update on every change, and party:invite fires when
// someone invites you.

// Strings this module draws, keyed by the English itself: text handed to the
// `ui` helpers is translated for free, the rest goes through engine.t.
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

const ui = engine.ui;
const panel = ui.panel({ title: 'Party' });
panel.el.style.minWidth = '320px';
panel.el.style.fontSize = '16px';
ui.actionButton('Party', () => panel.toggle(), 'p');

let state = null; // null = solo, { leader, members, maxMembers } = in party

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

// The bars of the panel on screen, kept current in place: rebuilding the body
// on every tick would also wipe a name half typed into the invite box.
let bars = [];

function memberCard(name, isLeader) {
  const card = document.createElement('div');
  card.style.cssText =
    'display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-radius:6px;' +
    'background:var(--color-surface-muted);border:1px solid var(--color-border);';

  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:baseline;gap:8px;';
  const nameEl = document.createElement('span');
  nameEl.textContent = name;
  nameEl.style.cssText = 'font-weight:700;font-size:17px;';
  const level = document.createElement('span');
  level.style.cssText = 'font-size:13px;color:var(--color-text-muted);';
  head.append(nameEl, level);
  if (isLeader) {
    const badge = document.createElement('span');
    badge.textContent = '★ ' + engine.t('Leader');
    badge.style.cssText =
      'margin-left:auto;font-size:12px;font-weight:700;letter-spacing:.06em;' +
      'text-transform:uppercase;color:var(--color-warning);';
    head.append(badge);
  }

  const track = document.createElement('div');
  track.setAttribute('role', 'meter');
  track.setAttribute('aria-label', name);
  track.style.cssText =
    'position:relative;height:16px;border-radius:8px;overflow:hidden;background:rgba(0,0,0,.4);';
  const fill = document.createElement('div');
  fill.style.cssText = 'height:100%;width:0;transition:width .25s;';
  const text = document.createElement('span');
  text.style.cssText =
    'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
    'font:600 12px sans-serif;color:#fff;text-shadow:0 1px 2px #000;';
  track.append(fill, text);

  card.append(head, track);
  bars.push({ name, level, track, fill, text });
  return card;
}

function refreshBars() {
  for (const bar of bars) {
    const p = seen(bar.name);
    if (!p) {
      bar.level.textContent = '';
      bar.fill.style.width = '0';
      bar.text.textContent = engine.t('Out of sight');
      bar.track.style.opacity = '0.5';
      continue;
    }
    const share = Math.max(0, Math.min(1, p.health / p.maxHealth));
    bar.level.textContent = engine.t('Level {level}', { level: p.level });
    bar.fill.style.width = `${share * 100}%`;
    bar.fill.style.background = healthColor(share);
    bar.text.textContent = `${Math.round(p.health)} / ${p.maxHealth}`;
    bar.track.setAttribute('aria-valuenow', String(Math.round(share * 100)));
    bar.track.style.opacity = '1';
  }
}

function render() {
  bars = [];
  if (!state) {
    const nameInput = ui.input('Player name to invite');
    const createBtn = ui.button('Create Party', () =>
      engine.sendServerEvent('party:create'),
    );
    const inviteBtn = ui.button('Invite', () => {
      const v = nameInput.value.trim();
      if (v) engine.sendServerEvent('party:invite', { name: v });
    });
    panel.setTitle('Party');
    panel.setBody(createBtn, ui.row(nameInput, inviteBtn));
    return;
  }

  // The leader first: the one the party is named after, and who invites.
  const order = [
    state.leader,
    ...state.members.filter((m) => m !== state.leader),
  ];
  const memberList = ui.column(
    ...order.map((m) => memberCard(m, m === state.leader)),
  );

  const nameInput = ui.input('Invite player');
  const inviteBtn = ui.button('Invite', () => {
    const v = nameInput.value.trim();
    if (v) engine.sendServerEvent('party:invite', { name: v });
    nameInput.value = '';
  });
  const leaveBtn = ui.button('Leave', () =>
    engine.sendServerEvent('party:leave'),
  );
  leaveBtn.style.cssText += 'background:var(--color-danger);width:100%;';
  leaveBtn.onmouseenter = () => (leaveBtn.style.background = '#e74c3c');
  leaveBtn.onmouseleave = () =>
    (leaveBtn.style.background = 'var(--color-danger)');

  panel.setTitle(
    engine.t('Party ({size}/{max})', {
      size: state.members.length,
      max: state.maxMembers,
    }),
  );
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.style.cssText =
    'margin:0 0 4px;max-width:320px;line-height:1.4;font-size:14px;color:var(--color-success);';
  status.textContent =
    state.members.length > 1
      ? engine.t('Party ready. Stay together to share experience.')
      : '';
  panel.setBody(status, memberList, ui.row(nameInput, inviteBtn), leaveBtn);
  refreshBars();
}

engine.onServerEvent('party:update', (data) => {
  const joined =
    data?.members?.length > 1 &&
    (state?.members?.length ?? 0) < data.members.length;
  state = data;
  render();
  if (joined) panel.show();
});

// Health changes every tick and the party pushes nothing for it.
setInterval(() => {
  if (panel.isOpen()) refreshBars();
}, 250);

engine.onServerEvent('party:invite', ({ from }) => {
  const notif = ui.panel({
    title: engine.t('Party invite from {player}', { player: from }),
  });
  notif.el.style.minWidth = '300px';
  notif.el.style.fontSize = '16px';
  const why = document.createElement('p');
  why.textContent = engine.t('Join to fight together and share experience.');
  why.style.cssText = 'margin:0 0 4px;line-height:1.4;';
  const acceptBtn = ui.button('Accept', () => {
    engine.sendServerEvent('party:accept', { leader: from });
    notif.remove();
  });
  const declineBtn = ui.button('Decline', () => notif.remove());
  for (const b of [acceptBtn, declineBtn]) {
    b.style.cssText +=
      'flex:1;padding:10px 12px;font-size:15px;font-weight:600;';
  }
  notif.setBody(why, ui.row(acceptBtn, declineBtn));
  notif.show();
  setTimeout(() => notif.remove(), 30_000);
});

engine.registerPlayerAction('Invite to Party', (name) => {
  engine.sendServerEvent('party:invite', { name });
});

engine.sendServerEvent('party:request');
render();
