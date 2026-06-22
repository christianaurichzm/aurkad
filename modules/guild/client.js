// Guild module, client entry: a live guild panel with a create or join
// form without a guild, the member list and Leave with one. Actions go to
// the server as custom actions, which push guild:update back.

const panel = engine.mount();
panel.style.cssText =
  'position:absolute;bottom:12px;left:12px;width:180px;padding:10px 12px;' +
  'background:rgba(0,0,0,0.7);color:#fff;border-radius:6px;font:13px sans-serif;';

let current = null;

function el(tag, props, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children) node.append(c);
  return node;
}

function renderForm() {
  panel.innerHTML = '';
  const name = el('input', {
    placeholder: 'Guild name',
    style: 'width:100%;box-sizing:border-box;margin:4px 0;',
  });
  const create = el('button', { textContent: 'Create', style: 'flex:1;' });
  const join = el('button', { textContent: 'Join', style: 'flex:1;' });
  create.onclick = () => name.value.trim() && engine.sendServerEvent('guild:create', { name: name.value.trim() });
  join.onclick = () => name.value.trim() && engine.sendServerEvent('guild:join', { name: name.value.trim() });
  panel.append(
    el('div', { textContent: 'Guild', style: 'font-weight:bold;margin-bottom:4px;' }),
    name,
    el('div', { style: 'display:flex;gap:6px;' }, create, join),
  );
}

function renderGuild(guild) {
  panel.innerHTML = '';
  const members = guild.members
    .map((m) => (m === guild.leader ? '★ ' + m : '• ' + m))
    .join('<br>');
  const leave = el('button', { textContent: 'Leave', style: 'margin-top:6px;width:100%;' });
  leave.onclick = () => engine.sendServerEvent('guild:leave');
  panel.append(
    el('div', { textContent: guild.name, style: 'font-weight:bold;margin-bottom:4px;' }),
    el('div', { innerHTML: members }),
    leave,
  );
}

function render(guild) {
  current = guild;
  if (guild) renderGuild(guild);
  else renderForm();
}

engine.onServerEvent('guild:update', render);
engine.sendServerEvent('guild:request');
render(current); // show the form immediately while we wait for the server
