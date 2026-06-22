// Guild module, client entry: a live, read-only panel of the player's
// guild, rendered with the injected `engine` API. Membership changes go
// through the /guild chat commands.

const panel = engine.mount();
panel.style.cssText =
  'position:absolute;bottom:12px;left:12px;min-width:160px;padding:8px 12px;' +
  'background:rgba(0,0,0,0.6);color:#fff;border-radius:6px;font:13px sans-serif;' +
  'pointer-events:none;';

function render(guild) {
  if (!guild) {
    panel.style.display = 'none';
    panel.innerHTML = '';
    return;
  }
  panel.style.display = 'block';
  const members = guild.members
    .map((m) => (m === guild.leader ? '★ ' + m : '• ' + m))
    .join('<br>');
  panel.innerHTML =
    '<div style="font-weight:bold;margin-bottom:4px">' + guild.name + '</div>' + members;
}

engine.onServerEvent('guild:update', render);

// Ask the server for our current guild now that we're listening.
engine.sendServerEvent('guild:request');
