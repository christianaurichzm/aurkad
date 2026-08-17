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
  },
});

const ui = engine.ui;
const panel = ui.panel({ title: 'Party' });
ui.actionButton('Party', () => panel.toggle(), 'p');

let state = null; // null = solo, { leader, members, maxMembers } = in party

function memberLine(name, isLeader) {
  const el = document.createElement('div');
  el.textContent = (isLeader ? '★ ' : '• ') + name;
  el.style.cssText = 'padding:2px 0;font-size:13px;';
  return el;
}

function render() {
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

  const memberList = document.createElement('div');
  memberList.style.cssText =
    'margin-bottom:4px;padding:4px 0;border-bottom:1px solid #333;';
  for (const m of state.members) {
    memberList.appendChild(memberLine(m, m === state.leader));
  }

  const nameInput = ui.input('Invite player');
  const inviteBtn = ui.button('Invite', () => {
    const v = nameInput.value.trim();
    if (v) engine.sendServerEvent('party:invite', { name: v });
    nameInput.value = '';
  });
  const leaveBtn = ui.button('Leave', () =>
    engine.sendServerEvent('party:leave'),
  );
  leaveBtn.style.cssText += 'background:#c0392b;margin-top:4px;width:100%;';
  leaveBtn.onmouseenter = () => (leaveBtn.style.background = '#e74c3c');
  leaveBtn.onmouseleave = () => (leaveBtn.style.background = '#c0392b');

  panel.setTitle(
    engine.t('Party ({size}/{max})', {
      size: state.members.length,
      max: state.maxMembers,
    }),
  );
  panel.setBody(memberList, ui.row(nameInput, inviteBtn), leaveBtn);
}

engine.onServerEvent('party:update', (data) => {
  state = data;
  render();
});

engine.onServerEvent('party:invite', ({ from }) => {
  const notif = ui.panel({
    title: engine.t('Party invite from {player}', { player: from }),
  });
  const acceptBtn = ui.button('Accept', () => {
    engine.sendServerEvent('party:accept', { leader: from });
    notif.remove();
  });
  const declineBtn = ui.button('Decline', () => notif.remove());
  declineBtn.style.background = '#555';
  declineBtn.onmouseenter = () => (declineBtn.style.background = '#777');
  declineBtn.onmouseleave = () => (declineBtn.style.background = '#555');
  notif.setBody(ui.row(acceptBtn, declineBtn));
  notif.show();
  setTimeout(() => notif.remove(), 30_000);
});

engine.registerPlayerAction('Invite to Party', (name) => {
  engine.sendServerEvent('party:invite', { name });
});

engine.sendServerEvent('party:request');
render();
