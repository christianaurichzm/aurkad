// @ts-check
// Starter game script: edit this file to define your game's rules.
// Everything here runs on the server, and saving hot-reloads it.
// Full API reference at the bottom of this file; types in scripts/global.d.ts.

// ─── MODULES ─────────────────────────────────────────────────────────────────
// Grab module APIs once at load time. They are undefined if the module is
// disabled in game.json. Guard with `if (dialog) ...` when in doubt.

const dialog = use("dialog"); // NPC dialog boxes (press F near an NPC)
const quest = use("quest"); // quest tracker panel (Q key)

// ─── QUESTS ──────────────────────────────────────────────────────────────────
// Define all quests at load time. quest.define is safe to call again on
// hot reload: progress lives in the player's data bag, not the definition.

if (quest) {
  quest.define({
    id: "goblinHunt",
    name: "Goblin Hunt",
    description: "Defeat 3 Goblins for the Elder.",
    target: 3,
    reward: (player) => {
      giveExperience(player, 100);
      giveItem(player, 1, 2); // 2× Health Potion (item id 1)
      sendMessage(player, "The Elder rewards you with potions and experience.");
    },
  });

  quest.define({
    id: "orcSlayer",
    name: "Orc Slayer",
    description: "Prove yourself by defeating 5 Orcs.",
    target: 5,
    reward: (player) => {
      giveExperience(player, 500);
      giveItem(player, 8, 1); // Steel Sword (item id 8)
      sendMessage(player, "The Elder gives you a steel sword as reward!");
    },
  });
}

// ─── WELCOME ─────────────────────────────────────────────────────────────────

on("playerJoin", ({ player }) => {
  sendMessage(
    player,
    `Welcome, ${player.name}! Press F near an NPC to interact.`,
  );

  // Give a starter kit to brand-new players (level 1, empty inventory).
  if (player.level === 1 && player.inventory.items.length === 0) {
    giveItem(player, 1, 3); // 3× Health Potion
    giveItem(player, 3, 10); // 10 Gold Coins
    sendMessage(
      player,
      "You received a starter kit: 3 Health Potions and 10 Gold Coins.",
    );
  }
});

on("playerLevelUp", ({ player, level }) => {
  broadcastMessage(`★ ${player.name} reached level ${level}!`);
});

// ─── NPC INTERACTIONS ────────────────────────────────────────────────────────
// Press F while facing an NPC to trigger npcInteract.

on("npcInteract", ({ player, npc }) => {
  if (!dialog) return;

  if (npc.name === "Elder") {
    handleElderDialog(player);
    return;
  }

  // Default: any other friendly/neutral NPC gets a generic greeting.
  dialog.show(player, { text: `${npc.name}: Greetings, traveler.` });
});

function handleElderDialog(player) {
  if (!quest || !dialog) return;

  const goblinQ = quest.get(player, "goblinHunt");
  const orcQ = quest.get(player, "orcSlayer");

  if (!goblinQ) {
    // First visit: offer the introductory quest.
    dialog.show(
      player,
      {
        text: "Elder: Our village is overrun by goblins. Will you help us?",
        choices: ["I will help", "Maybe later"],
      },
      (choice) => {
        if (choice === 0) {
          quest.start(player, "goblinHunt");
          dialog.show(player, {
            text: "Elder: Slay 3 Goblins and return to me. Safe travels.",
          });
        }
      },
    );
    return;
  }

  if (goblinQ.status === "active") {
    dialog.show(player, {
      text: `Elder: You have defeated ${goblinQ.progress} of ${goblinQ.target} goblins. Keep going!`,
    });
    return;
  }

  // Goblin quest done: offer the next one if available.
  if (!orcQ) {
    dialog.show(
      player,
      {
        text: "Elder: You have my thanks! But stronger foes lurk to the east - Orcs. Will you face them?",
        choices: ["I accept", "Not yet"],
      },
      (choice) => {
        if (choice === 0) quest.start(player, "orcSlayer");
      },
    );
    return;
  }

  if (orcQ.status === "active") {
    dialog.show(player, {
      text: `Elder: ${orcQ.progress}/${orcQ.target} orcs defeated. You are almost there!`,
    });
    return;
  }

  dialog.show(player, {
    text: "Elder: You are a true hero. The village is forever grateful.",
  });
}

// ─── QUEST PROGRESSION ───────────────────────────────────────────────────────

on("npcDeath", ({ npc, killer }) => {
  if (!quest) return;
  if (npc.name === "Goblin") quest.advance(killer, "goblinHunt", 1);
  if (npc.name === "Orc") quest.advance(killer, "orcSlayer", 1);
});

// ─── DEATH ───────────────────────────────────────────────────────────────────

on("playerDeath", ({ player, killer }) => {
  const by = killer ? ` by ${killer.name}` : "";
  broadcastMessage(`${player.name} was defeated${by}.`);
});

// ─── ADMIN COMMANDS ──────────────────────────────────────────────────────────

command(
  "heal",
  { access: Access.MOD, description: "Fully heal a player" },
  ({ args, reply }) => {
    const target = args[0] ? getPlayer(args[0]) : null;
    if (!target) return reply("Usage: /heal <player>");
    healPlayer(target);
    reply(`${target.name} healed.`);
  },
);

command(
  "give",
  {
    access: Access.ADMIN,
    description: "Give item to a player: /give <player> <itemId> [qty]",
  },
  ({ args, reply }) => {
    const target = getPlayer(args[0]);
    const itemId = parseInt(args[1]);
    const qty = parseInt(args[2]) || 1;
    if (!target || !itemId)
      return reply("Usage: /give <player> <itemId> [qty]");
    giveItem(target, itemId, qty);
    reply(`Gave ${qty}× item #${itemId} to ${target.name}.`);
  },
);

command(
  "tp",
  {
    access: Access.ADMIN,
    description: "Teleport: /tp <player> <mapId> <col> <row>",
  },
  ({ args, reply }) => {
    const target = getPlayer(args[0]);
    const mapId = args[1];
    const col = parseInt(args[2]);
    const row = parseInt(args[3]);
    if (!target || !mapId || isNaN(col) || isNaN(row))
      return reply("Usage: /tp <player> <mapId> <col> <row>");
    teleportPlayer(target, mapId, col, row);
    reply(`Teleported ${target.name} to map ${mapId} (${col}, ${row}).`);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// COOKBOOK: copy any block above the dashed line to activate it
// ─────────────────────────────────────────────────────────────────────────────

// ── VIP system ───────────────────────────────────────────────────────────────
//
// const isVip = (p) => getPlayerData(p, 'vip') === true;
//
// command('vip', { access: Access.ADMIN, description: 'Grant VIP' }, ({ args, reply }) => {
//   const target = getPlayer(args[0]);
//   if (!target) return reply('Usage: /vip <player>');
//   setPlayerData(target, 'vip', true);
//   setNameColor(target, 'gold');
//   reply(`${target.name} is now VIP.`);
// });
//
// command('vipheal', { canRun: isVip, description: 'VIP-only heal' }, ({ player, reply }) => {
//   if (!player) return reply('In-game only.');
//   healPlayer(player);
//   reply('VIP perk: full health.');
// });
//
// on('playerJoin', ({ player }) => {
//   if (isVip(player)) setNameColor(player, 'gold');
// });
//
// on('beforeXpGain', (ctx) => {
//   if (isVip(ctx.player)) ctx.amount *= 2;
// });

// ── Kill leaderboard (shared store) ──────────────────────────────────────────
//
// on('npcDeath', ({ killer }) => {
//   const kills = (store.get('leaderboard', killer.name) ?? 0) + 1;
//   store.set('leaderboard', killer.name, kills);
//   if (kills % 100 === 0) broadcastMessage(`${killer.name} reached ${kills} kills!`);
// });
//
// command('top', { description: 'Show top 5 killers' }, ({ reply }) => {
//   const entries = store.entries('leaderboard')
//     .sort((a, b) => b[1] - a[1]).slice(0, 5);
//   if (!entries.length) return reply('No kills yet.');
//   reply(entries.map(([name, n], i) => `${i + 1}. ${name}: ${n}`).join(' | '));
// });

// ── Milestone item reward on level up ────────────────────────────────────────
//
// on('playerLevelUp', ({ player, level }) => {
//   if (level === 10) {
//     giveItem(player, 2, 1); // Iron Sword at level 10
//     sendMessage(player, 'You earned an Iron Sword for reaching level 10!');
//   }
// });

// ── Double XP on weekends ────────────────────────────────────────────────────
//
// on('beforeXpGain', (ctx) => {
//   const day = new Date().getDay();
//   if (day === 0 || day === 6) ctx.amount *= 2;
// });

// ── Custom client event: player requests their kill stats ────────────────────
//
// on('customAction', ({ player, channel }) => {
//   if (channel !== 'stats:request') return;
//   const kills = store.get('leaderboard', player.name) ?? 0;
//   sendEvent(player, 'stats:reply', { kills });
// });

// ── Tick loop: runs ~20×/sec; throttle with tick % n ────────────────────────
//
// on('tick', ({ tick }) => {
//   if (tick % 20 !== 0) return; // ~once per second
//   for (const p of getPlayers()) {
//     // regen buff, poison tick, boss phases, etc.
//   }
// });

// ── Attached behavior: the content points at your code, not the reverse ────
//
// `on` is a global listener: it fires for EVERY npc and you filter. That works,
// but the filtering grows with every special entity until the script is one big
// switchboard of `if (npc.id === ...)`.
//
// `attach` is the other direction. You register a behavior under a name, and
// the content names it: an NPC and an item have a "Script behavior" field in
// the editor, and a tile can carry a `script` trigger. The designer wires it up
// without touching code.
//
// attach('quest-giver', {
//   onInteract({ player, npc }) {
//     use('dialog').show(player, { text: `${npc.name}: bring me 5 pelts.` });
//   },
// });
//
// attach('lava', {
//   onEnter({ player }) { dealDamage(player, 10); },
// });
//
// attach('boss-drake', {
//   onDeath({ npc, killer }) {
//     say(`${killer.name} slew the Drake!`);
//     giveItem(killer, Items.DrakeScale, 1);
//   },
// });
//
// attach('teleport-scroll', {
//   onUse({ player }) { warpPlayer(player, Maps.Town, 9, 6); },
// });
//
// One name can carry several of these at once: a boss that talks, hurts you on
// its tile and drops loot is one attach with three handlers. Registrations are
// dropped when the script reloads, and a name the content references but no
// script registers is reported at boot and when saving in the editor.

// ─────────────────────────────────────────────────────────────────────────────
// API REFERENCE (quick look-up; full types in scripts/global.d.ts)
// ─────────────────────────────────────────────────────────────────────────────
//
// HOOKS (on)
//   playerJoin / playerLeave       { player }
//   playerDeath                    { player, killer? }
//   playerLevelUp                  { player, level }
//   npcDeath                       { npc, killer }
//   npcInteract                    { player, npc }         - player pressed F
//   tileEnter                      { player, tile, map }
//   itemUse / itemPickup           { player, itemId, quantity? }
//   chatMessage                    { player, scope, message }
//   beforeDamage                   { attacker?, target, damage: { value } }  - mutate damage.value
//   beforeXpGain                   { player, amount }      - mutate amount
//   customAction                   { player, channel, payload }  - from client sendServerEvent
//   tick                           { tick }                - 20/s; throttle with tick % n
//
// ATTACHED BEHAVIOR (attach): runs only for content naming this id
//   attach(scriptId, { onEnter, onInteract, onDeath, onUse })
//   onEnter     { player, tile, map }        tile with a `script` trigger
//   onInteract  { player, npc }              NPC's "Script behavior" field
//   onDeath     { npc, killer }              same NPC, when killed
//   onUse       { player, item, itemId }     item's "Script behavior" field
//                                            (consumables only - no equip event)
//
// PLAYERS
//   getPlayer(name)                → PlayerServer | undefined
//   getPlayers()                   → PlayerServer[]
//   sendMessage(player, text)      private message
//   broadcastMessage(text)         all players
//   healPlayer(player)             full health
//   killPlayer(player)             kill + respawn
//   teleportPlayer(p, mapId, col, row)
//   giveItem(player, itemId, qty)
//   removeItem(player, itemId, qty)
//   giveExperience(player, amount) - passes through beforeXpGain
//   dealDamage(target, amount, attacker?)
//   setNameColor(player, color)    - cosmetic name color (undefined to clear)
//   setNameTag(player, tag)        - cosmetic tag above name (e.g. guild)
//   getPlayerData(player, key)     - read persisted custom field
//   setPlayerData(player, key, val)- write persisted custom field
//
// NPCS
//   getNearbyNpcs(mapId, x, y, radius)  → RuntimeNpc[]
//   spawnNpc({ mapId, col, row, name?, sprite?, maxHealth?, attack?, behavior? })
//   despawnNpc(npc)
//   moveNpcToward(npc, x, y)       - one tile step (call every ~25 ticks)
//
// STORE (shared, persisted KV)
//   store.get(scope, key)          store.set(scope, key, value)
//   store.delete(scope, key)       store.keys(scope)   store.entries(scope)
//
// EVENTS (to client)
//   sendEvent(player, channel, payload)
//   sendMapEvent(mapId, channel, payload)
//   broadcastEvent(channel, payload)
//
// COMMANDS
//   command(name, handler)
//   command(name, { access, description, canRun }, handler)
//   Access.USER = 0 | Access.MOD = 1 | Access.ADMIN = 2
//
// MODULES
//   use('dialog').show(player, { text, choices? }, onChoice?)
//   use('quest').define(def) / start(p, id) / advance(p, id, n?) / get(p, id)
//   use('magic').defineSpell({ id, name, manaCost, cooldownMs, cast(player) })
//   use('guild').guildOf(player) / isMember(p, name) / members(name)
//   use('party').partyOf(player) / isMember(p, name) / members(name)
//
// SCHEDULING (ticks, not milliseconds; see below)
//   after(ticks, fn)               → id   run once, `ticks` from now
//   every(ticks, fn)               → id   repeat forever
//   cancel(id)                     stop a scheduled task
//   msToTicks(ms)                  → ticks  e.g. after(msToTicks(3000), fn)
//   Auto-cancelled when the script reloads, so no duplicates on hot reload.
//
// RANDOM (deterministic: always prefer these over Math.random)
//   random()                       → [0, 1)
//   randomInt(maxExclusive)        → integer
//   randomChance(percent)          → boolean, percent is 0-100
//   randomPick(array)              → element | undefined
//
//   Why ticks and why this random: the sim runs on a seeded, tick-driven loop,
//   so replays reproduce a session exactly. Wall-clock timers (setTimeout) and
//   Math.random escape that - the recorder never sees them and a replay drifts.
//   setTimeout/setInterval still work but are deprecated and log a warning.
//
// CONSTANTS
//   TILE_SIZE                      - tile size in pixels (positions are in pixels)
//   TICK_RATE                      - ticks per second (default 20)
//
// CONTENT CONSTANTS (generated from your content; autocomplete by name)
//   Items.<Name>   Npcs.<Name>   Maps.<Name>   Spells.<Name>   Arrows.<Name>
//   e.g. giveItem(player, Items.SteelSword, 1)   instead of a raw id
//   Names come from the content's name field; edit content in the admin tools
//   and save to regenerate. Reload a script to pick up newly added content.
