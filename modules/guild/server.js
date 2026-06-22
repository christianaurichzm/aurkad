// Guild module, server entry, in the scripts' sandbox with its merged
// config as `config`. Guild records live in the KV store under scope
// "guild", and each member's guild name in their data bag.

const maxMembers = (config && config.maxMembers) || 50;

const myGuildName = (player) => getPlayerData(player, 'guild');
const getGuild = (name) => (name ? store.get('guild', name) : undefined);

command(
  'guild',
  { description: 'Guilds: /guild create|join|leave|list [name]' },
  ({ player, args, reply }) => {
    if (!player) return reply('Guild commands must be used in-game.');

    const sub = (args[0] || '').toLowerCase();
    const name = args[1];

    if (sub === 'create') {
      if (!name) return reply('Usage: /guild create <name>');
      if (myGuildName(player)) return reply('Leave your current guild first.');
      if (getGuild(name)) return reply('That guild name is taken.');
      store.set('guild', name, { name, leader: player.name, members: [player.name] });
      setPlayerData(player, 'guild', name);
      return reply(`Guild "${name}" created.`);
    }

    if (sub === 'join') {
      if (!name) return reply('Usage: /guild join <name>');
      if (myGuildName(player)) return reply('Leave your current guild first.');
      const g = getGuild(name);
      if (!g) return reply('No such guild.');
      if (g.members.length >= maxMembers) return reply('That guild is full.');
      g.members.push(player.name);
      store.set('guild', name, g);
      setPlayerData(player, 'guild', name);
      return reply(`Joined "${name}".`);
    }

    if (sub === 'leave') {
      const gn = myGuildName(player);
      const g = getGuild(gn);
      if (!g) return reply('You are not in a guild.');
      g.members = g.members.filter((m) => m !== player.name);
      setPlayerData(player, 'guild', undefined);
      if (g.members.length === 0) {
        store.delete('guild', gn);
      } else {
        if (g.leader === player.name) g.leader = g.members[0];
        store.set('guild', gn, g);
      }
      return reply(`You left "${gn}".`);
    }

    if (sub === 'list') {
      const g = getGuild(myGuildName(player));
      if (!g) return reply('You are not in a guild.');
      return reply(`${g.name} (${g.members.length}/${maxMembers}): ${g.members.join(', ')}`);
    }

    reply('Usage: /guild create|join|leave|list [name]');
  },
);

log(`Guild module ready (maxMembers=${maxMembers}).`);
