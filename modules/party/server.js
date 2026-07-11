// @ts-check
// Party module: runtime groups for an online session, not persisted, with
// nearby kill XP split through beforeXpGain.

const maxMembers = Math.max(2, Number((config && config.maxMembers) || 5));
const shareRadius = Math.max(0, Number((config && config.shareRadius) || 320));
const xpShareBonus = Math.max(0, Number((config && config.xpShareBonus) || 0));

const parties = new Map(); // leaderName -> { leader, members: string[] }
const memberToParty = new Map(); // playerName -> leaderName
const invites = new Map(); // targetName -> leaderName

const partyOfName = (name) => {
  const leader = memberToParty.get(name);
  return leader ? parties.get(leader) : undefined;
};
const partyOf = (player) => (player ? partyOfName(player.name) : undefined);

function partyPayload(party) {
  return party
    ? { leader: party.leader, members: party.members.slice(), maxMembers }
    : null;
}

function pushParty(party) {
  if (!party) return;
  const payload = partyPayload(party);
  for (const name of party.members) {
    const player = getPlayer(name);
    if (player) sendEvent(player, "party:update", payload);
  }
}

function pushPlayer(player) {
  sendEvent(player, "party:update", partyPayload(partyOf(player)));
}

function createParty(player) {
  if (partyOf(player)) return partyOf(player);
  const party = { leader: player.name, members: [player.name] };
  parties.set(player.name, party);
  memberToParty.set(player.name, player.name);
  pushPlayer(player);
  return party;
}

function invite(player, targetName) {
  const target = getPlayer(String(targetName || ""));
  if (!target) return "Player not found.";
  if (target.name === player.name) return "You cannot invite yourself.";
  if (partyOf(target)) return "That player is already in a party.";

  const party = createParty(player);
  if (party.leader !== player.name) return "Only the party leader can invite.";
  if (party.members.length >= maxMembers) return "Your party is full.";

  invites.set(target.name, party.leader);
  sendEvent(target, "party:invite", {
    from: player.name,
    leader: party.leader,
  });
  pushParty(party);
  return `Invited ${target.name}.`;
}

function accept(player, leaderName) {
  const leader = String(leaderName || invites.get(player.name) || "");
  const party = parties.get(leader);
  if (!party) return "No pending party invite.";
  if (invites.get(player.name) !== leader) return "No pending party invite.";
  if (partyOf(player)) return "Leave your current party first.";
  if (party.members.length >= maxMembers) return "That party is full.";

  party.members.push(player.name);
  memberToParty.set(player.name, party.leader);
  invites.delete(player.name);
  pushParty(party);
  return `Joined ${party.leader}'s party.`;
}

function leave(player) {
  const party = partyOf(player);
  if (!party) return "You are not in a party.";

  party.members = party.members.filter((name) => name !== player.name);
  memberToParty.delete(player.name);
  invites.delete(player.name);
  sendEvent(player, "party:update", null);

  if (party.members.length === 0) {
    parties.delete(party.leader);
    return "Left party.";
  }

  if (party.leader === player.name) {
    const oldLeader = party.leader;
    party.leader = party.members[0];
    parties.delete(oldLeader);
    parties.set(party.leader, party);
    for (const name of party.members) memberToParty.set(name, party.leader);
  }

  pushParty(party);
  return "Left party.";
}

function nearbyOnlineMembers(player) {
  const party = partyOf(player);
  if (!party) return [player];

  return party.members
    .map((name) => getPlayer(name))
    .filter((member) => {
      if (!member || member.health <= 0 || member.mapId !== player.mapId)
        return false;
      if (shareRadius <= 0) return true;
      const dx = member.position.x - player.position.x;
      const dy = member.position.y - player.position.y;
      return Math.sqrt(dx * dx + dy * dy) <= shareRadius;
    });
}

function members(nameOrPlayer) {
  const name =
    typeof nameOrPlayer === "string"
      ? nameOrPlayer
      : nameOrPlayer && nameOrPlayer.name;
  const party = name ? partyOfName(name) : undefined;
  return party ? party.members.slice() : [];
}

command(
  "party",
  { description: "Parties: /party create|invite|accept|leave|list [player]" },
  ({ player, args, reply }) => {
    if (!player) return reply("Party commands must be used in-game.");
    const sub = String(args[0] || "").toLowerCase();
    if (sub === "create") {
      createParty(player);
      return reply("Party ready.");
    }
    if (sub === "invite") return reply(invite(player, args[1]));
    if (sub === "accept") return reply(accept(player, args[1]));
    if (sub === "leave") return reply(leave(player));
    if (sub === "list") {
      const party = partyOf(player);
      if (!party) return reply("You are not in a party.");
      return reply(`${party.leader}'s party: ${party.members.join(", ")}`);
    }
    reply("Usage: /party create|invite|accept|leave|list [player]");
  },
);

on("customAction", ({ player, channel, payload }) => {
  const data = /** @type {any} */ (payload);
  if (channel === "party:create") createParty(player);
  else if (channel === "party:invite") invite(player, data && data.name);
  else if (channel === "party:accept") accept(player, data && data.leader);
  else if (channel === "party:leave") leave(player);
  else if (channel === "party:request") pushPlayer(player);
});

on("beforeXpGain", (ctx) => {
  const { player, amount, source } = ctx;
  if (source !== "kill" || !Number.isFinite(amount) || amount <= 0) return;
  const sharedWith = nearbyOnlineMembers(player);
  if (sharedWith.length < 2) return;

  const share = Math.max(1, Math.floor(amount / sharedWith.length));
  const awarded = Math.max(1, Math.floor(share * (1 + xpShareBonus)));
  ctx.amount = awarded;
  for (const member of sharedWith) {
    if (member.name !== player.name) giveExperience(member, awarded);
  }
});

on("playerLeave", ({ player }) => {
  leave(player);
  for (const [target, leader] of invites.entries()) {
    if (target === player.name || leader === player.name)
      invites.delete(target);
  }
});

provide("party", {
  create: createParty,
  invite,
  accept,
  leave,
  partyOf: (player) => partyPayload(partyOf(player)),
  members,
  isMember: (player, name) => members(player).includes(name),
});

log(
  `Party module ready (maxMembers=${maxMembers}, shareRadius=${shareRadius}).`,
);
