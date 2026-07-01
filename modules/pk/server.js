// @ts-check
// PK module. Killing a player on a 'normal' PvP map flags the killer with
// a red name for a while, set through the cosmetic resolver at high
// priority so it covers lower ones such as VIP gold until it expires.

const flagMs = ((config && config.flagMinutes) || 10) * 60 * 1000;
const PK_SOURCE = "pk";
const PK_PRIORITY = 100;

const isPk = (p) => {
  const until = getPlayerData(p, "pkUntil");
  return typeof until === "number" && Date.now() < until;
};

function flag(killer) {
  setPlayerData(killer, "pkUntil", Date.now() + flagMs);
  setPlayerData(killer, "pkCount", (getPlayerData(killer, "pkCount") || 0) + 1);
  setCosmetic(killer, "nameColor", PK_SOURCE, "red", PK_PRIORITY);
}

function unflag(p) {
  clearCosmetic(p, "nameColor", PK_SOURCE);
  setPlayerData(p, "pkUntil", undefined);
}

on("playerDeath", ({ player, killer }) => {
  if (!killer || killer.kind !== "player" || killer.name === player.name)
    return;
  if (getMapPvp(player.mapId) !== "normal") return; // only penalty maps flag
  flag(killer);
  broadcastMessage(killer.name + " became a player killer!");
});

// Re-apply the red name for a returning player who is still flagged.
on("playerJoin", ({ player }) => {
  if (isPk(player))
    setCosmetic(player, "nameColor", PK_SOURCE, "red", PK_PRIORITY);
});

// Drop the flag when it expires (~every 5s).
on("tick", ({ tick }) => {
  if (tick % 100 !== 0) return;
  for (const p of getPlayers()) {
    if (!isPk(p) && getPlayerData(p, "pkUntil") != null) unflag(p);
  }
});

command(
  "pk",
  { description: "Show your player-killer status" },
  ({ player, reply }) => {
    if (!player) return reply("In-game only.");
    const kills = getPlayerData(player, "pkCount") || 0;
    reply(
      isPk(player)
        ? `You are flagged as a PK (${kills} kills).`
        : `Not flagged. Kills: ${kills}.`,
    );
  },
);

provide("pk", { isPk });

log("PK module ready (flagMinutes=" + flagMs / 60000 + ").");
