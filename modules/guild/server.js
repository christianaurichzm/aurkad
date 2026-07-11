// @ts-check
// Guild module, server entry. Guilds are public or private (invite only),
// have owner, moderator and member roles, and give an XP bonus when enough
// members are online. A record with members as string[] is migrated the
// first time it is read.

const maxMembers = Number((config && config.maxMembers) || 50);
const xpBonus = Math.max(0, Number((config && config.xpBonus) || 0));
const xpBonusMinMembers = Math.max(
  2,
  Math.floor(Number((config && config.xpBonusMinMembers) || 3)),
);

// ---------- helpers ----------------------------------------------------------

/**
 * @typedef {{ name: string, role: 'owner'|'moderator'|'member' }} GuildMember
 * @typedef {{ name: string, privacy: 'public'|'private', leader: string, members: GuildMember[], invites: string[] }} Guild
 */

/** @param {any} g @returns {Guild} */
function migrate(g) {
  if (!g) return g;
  if (Array.isArray(g.members) && typeof g.members[0] === "string") {
    g.members = g.members.map((name, i) => ({
      name,
      role: i === 0 ? "owner" : "member",
    }));
  }
  if (!g.privacy) g.privacy = "public";
  if (!Array.isArray(g.invites)) g.invites = [];
  return g;
}

/** @returns {string|undefined} */
const myGuildName = (player) => getPlayerData(player, "guild");
/** @param {string|undefined} name @returns {Guild|undefined} */
const getGuild = (name) => migrate(name ? store.get("guild", name) : undefined);
const saveGuild = (g) => store.set("guild", g.name, g);

const roleOf = (g, name) => (g.members.find((m) => m.name === name) || {}).role;
const isOwner = (g, name) => roleOf(g, name) === "owner";
const isMod = (g, name) => roleOf(g, name) === "moderator";
const canManage = (g, name) => isOwner(g, name) || isMod(g, name);

function pushGuild(name) {
  const g = getGuild(name);
  if (!g) return;
  for (const { name: mName } of g.members) {
    const p = getPlayer(mName);
    if (p) sendEvent(p, "guild:update", { ...g, self: mName });
  }
}

function onlineMemberCount(g) {
  return g.members.filter(({ name }) => !!getPlayer(name)).length;
}

// ---------- operations -------------------------------------------------------

function createGuild(player, name, privacy) {
  if (!name) return "Provide a guild name.";
  if (myGuildName(player)) return "Leave your current guild first.";
  if (getGuild(name)) return "That guild name is taken.";
  const p = privacy === "private" ? "private" : "public";
  const g = {
    name,
    privacy: p,
    leader: player.name,
    members: [{ name: player.name, role: "owner" }],
    invites: [],
  };
  saveGuild(g);
  setPlayerData(player, "guild", name);
  setNameTag(player, name);
  sendEvent(player, "guild:update", { ...g, self: player.name });
  return `Guild "${name}" created (${p}).`;
}

function inviteToGuild(player, targetName) {
  const gn = myGuildName(player);
  const g = getGuild(gn);
  if (!g) return "You are not in a guild.";
  if (!canManage(g, player.name))
    return "Only officers and the owner can invite.";
  const target = getPlayer(String(targetName || ""));
  if (!target) return "Player not found or not online.";
  if (myGuildName(target)) return "That player is already in a guild.";
  if (g.members.length >= maxMembers) return "Your guild is full.";
  if (!g.invites.includes(target.name)) {
    g.invites.push(target.name);
    saveGuild(g);
  }
  sendEvent(target, "guild:invite", { guildName: gn, from: player.name });
  return `Invited ${target.name} to ${gn}.`;
}

function joinGuild(player, name) {
  if (!name) return "Provide a guild name.";
  if (myGuildName(player)) return "Leave your current guild first.";
  const g = getGuild(name);
  if (!g) return "No such guild.";
  if (g.privacy === "private")
    return "That guild is invite-only. Ask a member to invite you.";
  if (g.members.length >= maxMembers) return "That guild is full.";
  g.members.push({ name: player.name, role: "member" });
  saveGuild(g);
  setPlayerData(player, "guild", name);
  setNameTag(player, name);
  pushGuild(name);
  return `Joined "${name}".`;
}

function acceptInvite(player, guildName) {
  const name = String(guildName || "");
  if (myGuildName(player)) return "Leave your current guild first.";
  const g = getGuild(name);
  if (!g) return "No such guild.";
  if (!g.invites.includes(player.name))
    return "No pending invite from that guild.";
  if (g.members.length >= maxMembers) return "That guild is full.";
  g.members.push({ name: player.name, role: "member" });
  g.invites = g.invites.filter((n) => n !== player.name);
  saveGuild(g);
  setPlayerData(player, "guild", name);
  setNameTag(player, name);
  pushGuild(name);
  return `Joined "${name}".`;
}

function promote(player, targetName) {
  const gn = myGuildName(player);
  const g = getGuild(gn);
  if (!g) return "You are not in a guild.";
  if (!isOwner(g, player.name)) return "Only the owner can promote members.";
  const member = g.members.find((m) => m.name === targetName);
  if (!member) return "That player is not in your guild.";
  if (member.role === "owner") return "Cannot promote the owner.";
  if (member.role === "moderator")
    return `${targetName} is already a moderator.`;
  member.role = "moderator";
  saveGuild(g);
  pushGuild(gn);
  return `${targetName} promoted to moderator.`;
}

function demote(player, targetName) {
  const gn = myGuildName(player);
  const g = getGuild(gn);
  if (!g) return "You are not in a guild.";
  if (!isOwner(g, player.name)) return "Only the owner can demote members.";
  const member = g.members.find((m) => m.name === targetName);
  if (!member) return "That player is not in your guild.";
  if (member.role === "owner") return "Cannot demote the owner.";
  if (member.role === "member") return `${targetName} is already a member.`;
  member.role = "member";
  saveGuild(g);
  pushGuild(gn);
  return `${targetName} demoted to member.`;
}

function kick(player, targetName) {
  const gn = myGuildName(player);
  const g = getGuild(gn);
  if (!g) return "You are not in a guild.";
  if (!canManage(g, player.name))
    return "Only officers and the owner can kick.";
  if (targetName === player.name) return "You cannot kick yourself.";
  const target = g.members.find((m) => m.name === targetName);
  if (!target) return "That player is not in your guild.";
  if (target.role === "owner") return "Cannot kick the owner.";
  if (target.role === "moderator" && !isOwner(g, player.name))
    return "Only the owner can kick officers.";
  g.members = g.members.filter((m) => m.name !== targetName);
  saveGuild(g);
  pushGuild(gn);
  const kicked = getPlayer(targetName);
  if (kicked) {
    setPlayerData(kicked, "guild", undefined);
    setNameTag(kicked, undefined);
    sendEvent(kicked, "guild:update", null);
    sendEvent(kicked, "guild:kicked", { from: gn });
  }
  return `${targetName} was kicked.`;
}

function setPrivacy(player, privacy) {
  const gn = myGuildName(player);
  const g = getGuild(gn);
  if (!g) return "You are not in a guild.";
  if (!isOwner(g, player.name))
    return "Only the owner can change guild privacy.";
  const p = privacy === "private" ? "private" : "public";
  g.privacy = p;
  saveGuild(g);
  pushGuild(gn);
  return `Guild is now ${p}.`;
}

function leaveGuild(player) {
  const gn = myGuildName(player);
  if (!gn) return "You are not in a guild.";
  const g = getGuild(gn);
  if (!g) return "You are not in a guild.";
  const wasOwner = isOwner(g, player.name);
  g.members = g.members.filter((m) => m.name !== player.name);
  setPlayerData(player, "guild", undefined);
  setNameTag(player, undefined);
  sendEvent(player, "guild:update", null);
  if (g.members.length === 0) {
    store.delete("guild", gn);
    return `You left "${gn}" (guild disbanded).`;
  }
  if (wasOwner) {
    const nextOwner =
      g.members.find((m) => m.role === "moderator") || g.members[0];
    nextOwner.role = "owner";
    g.leader = nextOwner.name;
  }
  saveGuild(g);
  pushGuild(gn);
  return `You left "${gn}".`;
}

// ---------- commands ---------------------------------------------------------

command(
  "guild",
  {
    description:
      "Guild: create|join|invite|accept|leave|promote|demote|kick|privacy|info [arg]",
  },
  ({ player, args, reply }) => {
    if (!player) return reply("Guild commands must be used in-game.");
    const sub = (args[0] || "").toLowerCase();
    if (sub === "create") return reply(createGuild(player, args[1], args[2]));
    if (sub === "join") return reply(joinGuild(player, args[1]));
    if (sub === "invite") return reply(inviteToGuild(player, args[1]));
    if (sub === "accept") return reply(acceptInvite(player, args[1]));
    if (sub === "leave") return reply(leaveGuild(player));
    if (sub === "promote") return reply(promote(player, args[1]));
    if (sub === "demote") return reply(demote(player, args[1]));
    if (sub === "kick") return reply(kick(player, args[1]));
    if (sub === "privacy") return reply(setPrivacy(player, args[1]));
    if (sub === "info") {
      const g = getGuild(myGuildName(player));
      if (!g) return reply("You are not in a guild.");
      const list = g.members.map((m) => `${m.name}(${m.role[0]})`).join(", ");
      return reply(
        `[${g.privacy}] ${g.name} (${g.members.length}/${maxMembers}): ${list}`,
      );
    }
    reply(
      "Usage: /guild create|join|invite|accept|leave|promote|demote|kick|privacy|info [arg]",
    );
  },
);

// ---------- UI surface -------------------------------------------------------

on("customAction", ({ player, channel, payload }) => {
  const data = /** @type {any} */ (payload);
  if (channel === "guild:create")
    createGuild(player, String(data?.name || "").trim(), data?.privacy);
  else if (channel === "guild:join")
    joinGuild(player, String(data?.name || "").trim());
  else if (channel === "guild:invite")
    inviteToGuild(player, String(data?.target || "").trim());
  else if (channel === "guild:accept")
    acceptInvite(player, String(data?.guildName || "").trim());
  else if (channel === "guild:leave") leaveGuild(player);
  else if (channel === "guild:promote")
    promote(player, String(data?.target || ""));
  else if (channel === "guild:demote")
    demote(player, String(data?.target || ""));
  else if (channel === "guild:kick") kick(player, String(data?.target || ""));
  else if (channel === "guild:privacy")
    setPrivacy(player, String(data?.privacy || "public"));
  else if (channel === "guild:request") {
    const g = getGuild(myGuildName(player));
    sendEvent(player, "guild:update", g ? { ...g, self: player.name } : null);
  }
});

// ---------- hooks ------------------------------------------------------------

on("playerJoin", ({ player }) => {
  const gn = myGuildName(player);
  if (gn) setNameTag(player, gn);
});

if (xpBonus > 0) {
  on("beforeXpGain", (ctx) => {
    const gn = myGuildName(ctx.player);
    const g = gn ? getGuild(gn) : undefined;
    if (!g) return;
    if (onlineMemberCount(g) >= xpBonusMinMembers) {
      ctx.amount = Math.floor(ctx.amount * (1 + xpBonus));
    }
  });
}

// ---------- API --------------------------------------------------------------

provide("guild", {
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
