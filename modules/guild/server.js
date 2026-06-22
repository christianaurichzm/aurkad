// Guild module, server entry, in the scripts' sandbox with its merged
// config as `config`. Guild records live in the KV store under scope
// "guild", and each member's guild name in their data bag.
//
// Guilds are managed through /guild create|join|leave|list [name] in chat
// or the REPL, or the client panel (guild:create, guild:join, guild:leave),
// both through the same functions.

const maxMembers = (config && config.maxMembers) || 50;

const myGuildName = (player) => getPlayerData(player, 'guild');
const getGuild = (name) => (name ? store.get('guild', name) : undefined);

// Push the live guild record to every online member (drives the client panel).
function pushGuild(name) {
  const g = getGuild(name);
  if (!g) return;
  for (const member of g.members) {
    const p = getPlayer(member);
    if (p) sendEvent(p, 'guild:update', g);
  }
}

// --- Operations (shared by command + UI) -------------------------------------
// Each returns a status message.

function createGuild(player, name) {
  if (!name) return 'Usage: create a guild with a name.';
  if (myGuildName(player)) return 'Leave your current guild first.';
  if (getGuild(name)) return 'That guild name is taken.';
  store.set('guild', name, { name, leader: player.name, members: [player.name] });
  setPlayerData(player, 'guild', name);
  setNameTag(player, name);
  pushGuild(name);
  return `Guild "${name}" created.`;
}

function joinGuild(player, name) {
  if (!name) return 'Usage: join a guild by name.';
  if (myGuildName(player)) return 'Leave your current guild first.';
  const g = getGuild(name);
  if (!g) return 'No such guild.';
  if (g.members.length >= maxMembers) return 'That guild is full.';
  g.members.push(player.name);
  store.set('guild', name, g);
  setPlayerData(player, 'guild', name);
  setNameTag(player, name);
  pushGuild(name);
  return `Joined "${name}".`;
}

function leaveGuild(player) {
  const gn = myGuildName(player);
  const g = getGuild(gn);
  if (!g) return 'You are not in a guild.';
  g.members = g.members.filter((m) => m !== player.name);
  setPlayerData(player, 'guild', undefined);
  setNameTag(player, undefined);
  sendEvent(player, 'guild:update', null); // clear the leaver's panel
  if (g.members.length === 0) {
    store.delete('guild', gn);
  } else {
    if (g.leader === player.name) g.leader = g.members[0];
    store.set('guild', gn, g);
    pushGuild(gn);
  }
  return `You left "${gn}".`;
}

// --- Command surface ---------------------------------------------------------

command(
  'guild',
  { description: 'Guilds: /guild create|join|leave|list [name]' },
  ({ player, args, reply }) => {
    if (!player) return reply('Guild commands must be used in-game.');
    const sub = (args[0] || '').toLowerCase();
    const name = args[1];

    if (sub === 'create') return reply(createGuild(player, name));
    if (sub === 'join') return reply(joinGuild(player, name));
    if (sub === 'leave') return reply(leaveGuild(player));
    if (sub === 'list') {
      const g = getGuild(myGuildName(player));
      if (!g) return reply('You are not in a guild.');
      return reply(`${g.name} (${g.members.length}/${maxMembers}): ${g.members.join(', ')}`);
    }
    reply('Usage: /guild create|join|leave|list [name]');
  },
);

// --- UI surface (custom actions from the client panel) -----------------------

on('customAction', ({ player, channel, payload }) => {
  if (channel === 'guild:create') createGuild(player, String(payload?.name || '').trim());
  else if (channel === 'guild:join') joinGuild(player, String(payload?.name || '').trim());
  else if (channel === 'guild:leave') leaveGuild(player);
  else if (channel === 'guild:request') {
    // The panel asks for current state on load (it may have missed pushes).
    sendEvent(player, 'guild:update', getGuild(myGuildName(player)) || null);
  }
});

// Restore the name tag for a returning member (tags are runtime-only).
on('playerJoin', ({ player }) => {
  const gn = myGuildName(player);
  if (gn) setNameTag(player, gn);
});

// Expose a small API so other modules/scripts can query guild membership
// without knowing how guilds are stored. Consume it with: use('guild').
provide('guild', {
  guildOf: (player) => getGuild(myGuildName(player)),
  isMember: (player, name) => myGuildName(player) === name,
  members: (name) => getGuild(name)?.members ?? [],
});

log(`Guild module ready (maxMembers=${maxMembers}).`);
