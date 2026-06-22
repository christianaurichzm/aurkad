// Guild module, client entry, built on the engine UI toolkit so it
// matches the core look: a create or join form without a guild, the member
// list and Leave with one.

const ui = engine.ui;
const panel = ui.panel({ title: 'Guild', anchor: 'bottom-left' });

function renderForm() {
  const name = ui.input('Guild name');
  const create = ui.button('Create', () => {
    const v = name.value.trim();
    if (v) engine.sendServerEvent('guild:create', { name: v });
  });
  const join = ui.button('Join', () => {
    const v = name.value.trim();
    if (v) engine.sendServerEvent('guild:join', { name: v });
  });
  panel.setBody(name, ui.row(create, join));
}

function renderGuild(guild) {
  const members = document.createElement('div');
  members.innerHTML = guild.members
    .map((m) => (m === guild.leader ? '★ ' + m : '• ' + m))
    .join('<br>');
  const leave = ui.button('Leave', () => engine.sendServerEvent('guild:leave'));
  panel.setTitle(guild.name);
  panel.setBody(members, leave);
}

function render(guild) {
  if (guild) {
    renderGuild(guild);
  } else {
    panel.setTitle('Guild');
    renderForm();
  }
}

engine.onServerEvent('guild:update', render);
engine.sendServerEvent('guild:request');
render(null); // show the form while we wait for the server's reply
