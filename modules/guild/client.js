// Guild module, client entry. A Guild button in the Actions menu opens a
// panel: a create or join form without a guild, the member list and Leave
// with one. Actions go to the server entry, which pushes guild:update.

const ui = engine.ui;
const panel = ui.panel({ title: 'Guild' });
ui.actionButton('Guild', () => panel.toggle());

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
  panel.setTitle('Guild');
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

engine.onServerEvent('guild:update', (guild) => {
  if (guild) renderGuild(guild);
  else renderForm();
});

engine.sendServerEvent('guild:request');
renderForm(); // populate the panel so it's ready when opened
