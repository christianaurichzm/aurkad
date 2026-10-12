// @ts-check
// Guild module, server entry. Guilds are public or private (invite only),
// have owner, moderator and member roles, give an XP bonus when enough
// members are online, and can share a dungeon copy (config.sharedInstances).

i18n({
  pt: {
    'Provide a guild name.': 'Informe um nome de guilda.',
    'Leave your current guild first.': 'Saia da sua guilda atual primeiro.',
    'That guild name is taken.': 'Esse nome de guilda já existe.',
    'Guild "{name}" created ({privacy}).':
      'Guilda "{name}" criada ({privacy}).',
    'You are not in a guild.': 'Você não está em uma guilda.',
    'Only officers and the owner can invite.':
      'Só oficiais e o dono podem convidar.',
    'Player not found or not online.':
      'Jogador não encontrado ou fora do jogo.',
    'That player is already in a guild.': 'Esse jogador já está em uma guilda.',
    'Your guild is full.': 'Sua guilda está cheia.',
    'Invited {player} to {guild}.': '{player} foi convidado para {guild}.',
    'No such guild.': 'Guilda inexistente.',
    'That guild is invite-only. Ask a member to invite you.':
      'Essa guilda é só por convite. Peça a um membro para convidar você.',
    'That guild is full.': 'Essa guilda está cheia.',
    'Joined "{name}".': 'Você entrou em "{name}".',
    'No pending invite from that guild.':
      'Nenhum convite pendente dessa guilda.',
    'Only the owner can promote members.': 'Só o dono pode promover membros.',
    'That player is not in your guild.': 'Esse jogador não está na sua guilda.',
    'Cannot promote the owner.': 'Não dá para promover o dono.',
    '{player} is already a moderator.': '{player} já é moderador.',
    '{player} promoted to moderator.': '{player} promovido a moderador.',
    'Only the owner can demote members.': 'Só o dono pode rebaixar membros.',
    'Cannot demote the owner.': 'Não dá para rebaixar o dono.',
    '{player} is already a member.': '{player} já é membro.',
    '{player} demoted to member.': '{player} rebaixado a membro.',
    'Only officers and the owner can kick.':
      'Só oficiais e o dono podem expulsar.',
    'You cannot kick yourself.': 'Você não pode se expulsar.',
    'Cannot kick the owner.': 'Não dá para expulsar o dono.',
    'Only the owner can kick officers.': 'Só o dono pode expulsar oficiais.',
    '{player} was kicked.': '{player} foi expulso.',
    'Only the owner can change guild privacy.':
      'Só o dono pode mudar a privacidade da guilda.',
    'Guild is now {privacy}.': 'A guilda agora é {privacy}.',
    'You left "{name}" (guild disbanded).':
      'Você saiu de "{name}" (guilda dissolvida).',
    'You left "{name}".': 'Você saiu de "{name}".',
    'Guild commands must be used in-game.':
      'Os comandos de guilda só funcionam dentro do jogo.',
    '[{privacy}] {name} ({size}/{max}): {members}':
      '[{privacy}] {name} ({size}/{max}): {members}',
    'Usage: /guild create|join|invite|accept|leave|promote|demote|kick|privacy|info [arg]':
      'Uso: /guild create|join|invite|accept|leave|promote|demote|kick|privacy|info [arg]',
  },
});

const maxMembers = Number((config && config.maxMembers) || 50);
const xpBonus = Math.max(0, Number((config && config.xpBonus) || 0));
const xpBonusMinMembers = Math.max(
  2,
  Math.floor(Number((config && config.xpBonusMinMembers) || 3)),
);
const sharedInstances = !!(config && config.sharedInstances);

// ---------- helpers ----------------------------------------------------------

/**
 * @typedef {{ name: string, role: 'owner'|'moderator'|'member' }} GuildMember
 * @typedef {{ name: string, privacy: 'public'|'private', leader: string, members: GuildMember[], invites: string[] }} Guild
 */

/** @param {string|undefined} name @returns {Guild|undefined} */
const getGuild = (name) =>
  /** @type {Guild|undefined} */ (name ? store.get('guild', name) : undefined);

/**
 * The guild the player is in: the one their data names, while it still
 * lists them. A player kicked while offline still carries the name.
 *
 * @returns {string|undefined}
 */
const myGuildName = (player) => {
  const name = /** @type {string|undefined} */ (getPlayerData(player, 'guild'));
  const g = getGuild(name);
  return g && g.members.some((m) => m.name === player.name) ? name : undefined;
};
const saveGuild = (g) => store.set('guild', g.name, g);

const roleOf = (g, name) => (g.members.find((m) => m.name === name) || {}).role;
const isOwner = (g, name) => roleOf(g, name) === 'owner';
const isMod = (g, name) => roleOf(g, name) === 'moderator';
const canManage = (g, name) => isOwner(g, name) || isMod(g, name);

/**
 * The guild as the window shows it to `self`: who is in the game now, and at
 * what level, beside the roles that are stored.
 *
 * @param gone a player who is leaving, still registered when playerLeave runs
 *   and so still "online" to getPlayer.
 */
function guildFor(g, self, gone) {
  return {
    ...g,
    self,
    maxMembers,
    members: g.members.map((m) => {
      const p = m.name === gone ? undefined : getPlayer(m.name);
      return { ...m, online: !!p, level: p ? p.level : undefined };
    }),
  };
}

function pushGuild(name, gone) {
  const g = getGuild(name);
  if (!g) return;
  for (const { name: mName } of g.members) {
    const p = mName === gone ? undefined : getPlayer(mName);
    if (p) sendEvent(p, 'guild:update', guildFor(g, mName, gone));
  }
}

// The guilds anyone may walk into, largest first, for a player who is in none.
// Reads every guild per request; keep a list of the public ones if a
// game grows past a few hundred guilds.
function pushOpenGuilds(player) {
  const guilds = store
    .keys('guild')
    .map(getGuild)
    .filter((g) => g && g.privacy === 'public' && g.members.length < maxMembers)
    .map((g) => ({ name: g.name, members: g.members.length }))
    .sort((a, b) => b.members - a.members || a.name.localeCompare(b.name))
    .slice(0, 20);
  sendEvent(player, 'guild:list', { guilds, maxMembers });
}

function onlineMemberCount(g) {
  return g.members.filter(({ name }) => !!getPlayer(name)).length;
}

// ---------- operations -------------------------------------------------------

function createGuild(player, name, privacy) {
  if (!name) return 'Provide a guild name.';
  if (myGuildName(player)) return 'Leave your current guild first.';
  if (getGuild(name)) return 'That guild name is taken.';
  const p = privacy === 'private' ? 'private' : 'public';
  const g = {
    name,
    privacy: p,
    leader: player.name,
    members: [{ name: player.name, role: 'owner' }],
    invites: [],
  };
  saveGuild(g);
  setPlayerData(player, 'guild', name);
  setNameTag(player, name);
  sendEvent(player, 'guild:update', guildFor(g, player.name));
  return t(player, 'Guild "{name}" created ({privacy}).', {
    name,
    privacy: p,
  });
}

function inviteToGuild(player, targetName) {
  const gn = myGuildName(player);
  const g = getGuild(gn);
  if (!g) return 'You are not in a guild.';
  if (!canManage(g, player.name))
    return 'Only officers and the owner can invite.';
  const target = getPlayer(String(targetName || ''));
  if (!target) return 'Player not found or not online.';
  if (myGuildName(target)) return 'That player is already in a guild.';
  if (g.members.length >= maxMembers) return 'Your guild is full.';
  if (!g.invites.includes(target.name)) {
    g.invites.push(target.name);
    saveGuild(g);
  }
  sendEvent(target, 'guild:invite', { guildName: gn, from: player.name });
  return t(player, 'Invited {player} to {guild}.', {
    player: target.name,
    guild: gn,
  });
}

function joinGuild(player, name) {
  if (!name) return 'Provide a guild name.';
  if (myGuildName(player)) return 'Leave your current guild first.';
  const g = getGuild(name);
  if (!g) return 'No such guild.';
  if (g.privacy === 'private')
    return 'That guild is invite-only. Ask a member to invite you.';
  if (g.members.length >= maxMembers) return 'That guild is full.';
  g.members.push({ name: player.name, role: 'member' });
  saveGuild(g);
  setPlayerData(player, 'guild', name);
  setNameTag(player, name);
  pushGuild(name);
  return t(player, 'Joined "{name}".', { name });
}

function acceptInvite(player, guildName) {
  const name = String(guildName || '');
  if (myGuildName(player)) return 'Leave your current guild first.';
  const g = getGuild(name);
  if (!g) return 'No such guild.';
  if (!g.invites.includes(player.name))
    return 'No pending invite from that guild.';
  if (g.members.length >= maxMembers) return 'That guild is full.';
  g.members.push({ name: player.name, role: 'member' });
  g.invites = g.invites.filter((n) => n !== player.name);
  saveGuild(g);
  setPlayerData(player, 'guild', name);
  setNameTag(player, name);
  pushGuild(name);
  return t(player, 'Joined "{name}".', { name });
}

function promote(player, targetName) {
  const gn = myGuildName(player);
  const g = getGuild(gn);
  if (!g) return 'You are not in a guild.';
  if (!isOwner(g, player.name)) return 'Only the owner can promote members.';
  const member = g.members.find((m) => m.name === targetName);
  if (!member) return 'That player is not in your guild.';
  if (member.role === 'owner') return 'Cannot promote the owner.';
  if (member.role === 'moderator')
    return t(player, '{player} is already a moderator.', {
      player: targetName,
    });
  member.role = 'moderator';
  saveGuild(g);
  pushGuild(gn);
  return t(player, '{player} promoted to moderator.', { player: targetName });
}

function demote(player, targetName) {
  const gn = myGuildName(player);
  const g = getGuild(gn);
  if (!g) return 'You are not in a guild.';
  if (!isOwner(g, player.name)) return 'Only the owner can demote members.';
  const member = g.members.find((m) => m.name === targetName);
  if (!member) return 'That player is not in your guild.';
  if (member.role === 'owner') return 'Cannot demote the owner.';
  if (member.role === 'member')
    return t(player, '{player} is already a member.', { player: targetName });
  member.role = 'member';
  saveGuild(g);
  pushGuild(gn);
  return t(player, '{player} demoted to member.', { player: targetName });
}

function kick(player, targetName) {
  const gn = myGuildName(player);
  const g = getGuild(gn);
  if (!g) return 'You are not in a guild.';
  if (!canManage(g, player.name))
    return 'Only officers and the owner can kick.';
  if (targetName === player.name) return 'You cannot kick yourself.';
  const target = g.members.find((m) => m.name === targetName);
  if (!target) return 'That player is not in your guild.';
  if (target.role === 'owner') return 'Cannot kick the owner.';
  if (target.role === 'moderator' && !isOwner(g, player.name))
    return 'Only the owner can kick officers.';
  g.members = g.members.filter((m) => m.name !== targetName);
  saveGuild(g);
  pushGuild(gn);
  const kicked = getPlayer(targetName);
  if (kicked) {
    setPlayerData(kicked, 'guild', undefined);
    setNameTag(kicked, undefined);
    sendEvent(kicked, 'guild:update', null);
    sendEvent(kicked, 'guild:kicked', { from: gn });
  }
  return t(player, '{player} was kicked.', { player: targetName });
}

function setPrivacy(player, privacy) {
  const gn = myGuildName(player);
  const g = getGuild(gn);
  if (!g) return 'You are not in a guild.';
  if (!isOwner(g, player.name))
    return 'Only the owner can change guild privacy.';
  const p = privacy === 'private' ? 'private' : 'public';
  g.privacy = p;
  saveGuild(g);
  pushGuild(gn);
  return t(player, 'Guild is now {privacy}.', { privacy: p });
}

function leaveGuild(player) {
  const gn = myGuildName(player);
  if (!gn) return 'You are not in a guild.';
  const g = getGuild(gn);
  if (!g) return 'You are not in a guild.';
  const wasOwner = isOwner(g, player.name);
  g.members = g.members.filter((m) => m.name !== player.name);
  setPlayerData(player, 'guild', undefined);
  setNameTag(player, undefined);
  sendEvent(player, 'guild:update', null);
  if (g.members.length === 0) {
    store.delete('guild', gn);
    return t(player, 'You left "{name}" (guild disbanded).', { name: gn });
  }
  if (wasOwner) {
    const nextOwner =
      g.members.find((m) => m.role === 'moderator') || g.members[0];
    nextOwner.role = 'owner';
    g.leader = nextOwner.name;
  }
  saveGuild(g);
  pushGuild(gn);
  return t(player, 'You left "{name}".', { name: gn });
}

// ---------- commands ---------------------------------------------------------

command(
  'guild',
  {
    description:
      'Guild: create|join|invite|accept|leave|promote|demote|kick|privacy|info [arg]',
  },
  ({ player, args, reply }) => {
    if (!player) return reply('Guild commands must be used in-game.');
    const sub = (args[0] || '').toLowerCase();
    if (sub === 'create') return reply(createGuild(player, args[1], args[2]));
    if (sub === 'join') return reply(joinGuild(player, args[1]));
    if (sub === 'invite') return reply(inviteToGuild(player, args[1]));
    if (sub === 'accept') return reply(acceptInvite(player, args[1]));
    if (sub === 'leave') return reply(leaveGuild(player));
    if (sub === 'promote') return reply(promote(player, args[1]));
    if (sub === 'demote') return reply(demote(player, args[1]));
    if (sub === 'kick') return reply(kick(player, args[1]));
    if (sub === 'privacy') return reply(setPrivacy(player, args[1]));
    if (sub === 'info') {
      const g = getGuild(myGuildName(player));
      if (!g) return reply('You are not in a guild.');
      const list = g.members.map((m) => `${m.name}(${m.role[0]})`).join(', ');
      return reply(
        t(player, '[{privacy}] {name} ({size}/{max}): {members}', {
          privacy: g.privacy,
          name: g.name,
          size: g.members.length,
          max: maxMembers,
          members: list,
        }),
      );
    }
    reply(
      'Usage: /guild create|join|invite|accept|leave|promote|demote|kick|privacy|info [arg]',
    );
  },
);

// ---------- UI surface -------------------------------------------------------

// A chat command is answered in the chat; what the window asked for is
// answered to the window, which has no other way to say why nothing changed.
on('customAction', ({ player, channel, payload }) => {
  const data = /** @type {any} */ (payload);
  let said;
  if (channel === 'guild:create')
    said = createGuild(player, String(data?.name || '').trim(), data?.privacy);
  else if (channel === 'guild:join')
    said = joinGuild(player, String(data?.name || '').trim());
  else if (channel === 'guild:invite')
    said = inviteToGuild(player, String(data?.target || '').trim());
  else if (channel === 'guild:accept')
    said = acceptInvite(player, String(data?.guildName || '').trim());
  else if (channel === 'guild:leave') said = leaveGuild(player);
  else if (channel === 'guild:promote')
    said = promote(player, String(data?.target || ''));
  else if (channel === 'guild:demote')
    said = demote(player, String(data?.target || ''));
  else if (channel === 'guild:kick')
    said = kick(player, String(data?.target || ''));
  else if (channel === 'guild:privacy')
    said = setPrivacy(player, String(data?.privacy || 'public'));
  else if (channel === 'guild:list') pushOpenGuilds(player);
  else if (channel === 'guild:request') {
    const g = getGuild(myGuildName(player));
    sendEvent(player, 'guild:update', g ? guildFor(g, player.name) : null);
  }
  if (said) sendEvent(player, 'guild:result', { message: t(player, said) });
});

// ---------- hooks ------------------------------------------------------------

on('playerJoin', ({ player }) => {
  const gn = myGuildName(player);
  if (!gn) {
    // Kicked, or the guild disbanded, while they were away.
    if (getPlayerData(player, 'guild') !== undefined) {
      setPlayerData(player, 'guild', undefined);
      setNameTag(player, undefined);
    }
    return;
  }
  setNameTag(player, gn);
  pushGuild(gn);
});

on('playerLeave', ({ player }) => {
  const gn = myGuildName(player);
  if (gn) pushGuild(gn, player.name);
});

if (xpBonus > 0) {
  on('beforeXpGain', (ctx) => {
    const gn = myGuildName(ctx.player);
    const g = gn ? getGuild(gn) : undefined;
    if (!g) return;
    if (onlineMemberCount(g) >= xpBonusMinMembers) {
      ctx.amount = Math.floor(ctx.amount * (1 + xpBonus));
    }
  });
}

// Guildmates who go in together share a copy, like a party. Off by default,
// since a member could no longer run a dungeon alone. A party decides first.
if (sharedInstances) {
  on('instanceOwner', (ctx) => {
    if (ctx.owner !== ctx.player.name) return;
    const gn = myGuildName(ctx.player);
    if (gn) ctx.owner = `guild:${gn}`;
  });
}

// ---------- API --------------------------------------------------------------

provide('guild', {
  guildOf: (player) => getGuild(myGuildName(player)),
  isMember: (player, name) => myGuildName(player) === name,
  members: (name) => (getGuild(name)?.members ?? []).map((m) => m.name),
  roleOf: (player) => {
    const gn = myGuildName(player);
    const g = gn ? getGuild(gn) : undefined;
    return g ? roleOf(g, player.name) : undefined;
  },
});

log(`Guild module ready (maxMembers=${maxMembers}, xpBonus=${xpBonus}).`);
