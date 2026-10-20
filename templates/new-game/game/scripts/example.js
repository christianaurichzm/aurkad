// Your game's script: edit this file to define the rules. Everything here
// runs on the server, and saving hot-reloads it with no restart. A quick
// API reference is at the bottom; the full one, typed, is the engine's
// scripts/global.d.ts (`npm run docs:api` renders it).
//
// A new game starts with every module off, so `use('dialog')` and
// `use('quest')` below are undefined until you turn them on in game.json.

// ─── MODULES ─────────────────────────────────────────────────────────────────
// Grab module APIs once at load time. They are undefined if the module is
// disabled in game.json. Guard with `if (dialog) ...` when in doubt.

const dialog = use('dialog'); // NPC dialog boxes (press F near an NPC)
const quest = use('quest'); // quest tracker panel (Q key)

// ─── QUESTS ──────────────────────────────────────────────────────────────────
// Define all quests at load time. quest.define is safe to call again on
// hot reload: progress lives in the player's data bag, not the definition.

if (quest) {
  quest.define({
    id: 'skeletonHunt',
    name: 'Bones in the Meadow',
    description: 'Defeat 3 Skeletons for the Mage.',
    target: 3,
    reward: (player) => {
      giveExperience(player, 100);
      giveItem(player, 1, 2); // 2× Health Potion (item id 1)
      sendMessage(player, 'The Mage rewards you with potions and experience.');
    },
  });

  quest.define({
    id: 'boneKnight',
    name: 'The Bone Knight',
    description: 'Defeat the Bone Knight in the far corner of the meadow.',
    target: 1,
    reward: (player) => {
      giveExperience(player, 500);
      giveItem(player, 3, 1); // Short Sword (item id 3)
      sendMessage(player, 'The Mage gives you a short sword as reward!');
    },
  });
}

// ─── WELCOME ─────────────────────────────────────────────────────────────────

on('playerJoin', ({ player }) => {
  sendMessage(
    player,
    `Welcome, ${player.name}! Press F near an NPC to interact.`,
  );

  // Give a starter kit to brand-new players (level 1, empty inventory).
  if (player.level === 1 && player.inventory.items.length === 0) {
    giveItem(player, 1, 3); // 3× Health Potion
    giveItem(player, 2, 10); // 10 Gold Coins
    sendMessage(
      player,
      'You received a starter kit: 3 Health Potions and 10 Gold Coins.',
    );
  }
});

on('playerLevelUp', ({ player, level }) => {
  broadcastMessage(`★ ${player.name} reached level ${level}!`);
});

// ─── NPC INTERACTIONS ────────────────────────────────────────────────────────
// Press F while facing an NPC to trigger npcInteract.

on('npcInteract', ({ player, npc }) => {
  if (!dialog) return;

  // An NPC with a dialog or a behaviour set in the content editor is already
  // answered, by the dialog module or by the behaviour's onInteract, and
  // greeting them here would put a second box on screen for one keypress.
  if (npc.dialogId || npc.scriptId) return;

  if (npc.name === 'Mage') {
    handleMageDialog(player);
    return;
  }

  // Default: any other friendly/neutral NPC gets a generic greeting.
  dialog.show(player, { text: `${npc.name}: Greetings, traveler.` });
});

function handleMageDialog(player) {
  if (!quest || !dialog) return;

  const hunt = quest.get(player, 'skeletonHunt');
  const knight = quest.get(player, 'boneKnight');

  if (!hunt) {
    // First visit: offer the introductory quest.
    dialog.show(
      player,
      {
        text: 'Mage: The dead are walking in the meadow. Will you help me?',
        choices: ['I will help', 'Maybe later'],
      },
      (choice) => {
        if (choice === 0) {
          quest.start(player, 'skeletonHunt');
          dialog.show(player, {
            text: 'Mage: Put 3 Skeletons back in the ground and return to me.',
          });
        }
      },
    );
    return;
  }

  if (hunt.status === 'active') {
    dialog.show(player, {
      text: `Mage: You have defeated ${hunt.progress} of ${hunt.target} skeletons. Keep going!`,
    });
    return;
  }

  // First quest done: offer the next one if available.
  if (!knight) {
    dialog.show(
      player,
      {
        text: 'Mage: My thanks! But something raises them - a knight of bone, in the far corner. Will you face it?',
        choices: ['I accept', 'Not yet'],
      },
      (choice) => {
        if (choice === 0) quest.start(player, 'boneKnight');
      },
    );
    return;
  }

  if (knight.status === 'active') {
    dialog.show(player, {
      text: 'Mage: The Bone Knight still stands. Mind its sword.',
    });
    return;
  }

  dialog.show(player, {
    text: 'Mage: The meadow is quiet again. Thank you, hero.',
  });
}

// ─── AUTHORED DIALOGS ────────────────────────────────────────────────────────
// A conversation can also be a document in the content editor (Dialogs tab),
// which the dialog module walks: the same feature as handleMageDialog above,
// written in the editor instead of in code. Give an npc one and this file
// says nothing for it.
//
// What a document cannot hold is a rule, so a choice names one instead. These
// two are names a dialog's choices can use.

// Whether to offer the choice at all. A missing or throwing condition hides it.
provide('dialogCondition.skeletonSlayer', ({ player }) => {
  const hunt = quest && quest.get(player, 'skeletonHunt');
  return !!hunt && hunt.status === 'completed';
});

// What picking the choice does. If this throws, the conversation stops rather
// than showing the node that thanks the player for a reward they never got.
provide('dialogAction.campGift', ({ player }) => {
  if (getPlayerData(player, 'campGift')) return; // already paid, once per player
  setPlayerData(player, 'campGift', true);
  giveItem(player, 2, 25); // 25 Gold Coins
  sendMessage(player, 'You are handed 25 gold coins.');
});

// ─── LOOT CONDITIONS ─────────────────────────────────────────────────────────
// The same idea one collection over: a loot entry names a condition in the
// Loot tab, and the entry is filtered out before the roll whenever this
// answers anything but true. Nothing here is wired to shipped content;
// these give the editor's Condition field names that resolve, and show the
// failure mode: a name nothing registers removes the entry rather than
// granting it, which is why the boot check reports one.

// "Only drops for whoever actually fought it." Contribution is damage across
// the whole fight, not the killing blow, so a last-hit steal does not qualify.
provide('lootCondition.earnedIt', ({ contribution, totalDamage }) => {
  return totalDamage > 0 && contribution / totalDamage >= 0.25;
});

// Gate an entry on a live-ops flag, so a drop can be switched on for an event
// without touching content or restarting.
provide('lootCondition.eventActive', () => flags.enabled('lootEvent'));

// ─── QUEST PROGRESSION ───────────────────────────────────────────────────────

on('npcDeath', ({ npc, killer }) => {
  if (!quest) return;
  if (npc.name === 'Skeleton') quest.advance(killer, 'skeletonHunt', 1);
  if (npc.name === 'Bone Knight') quest.advance(killer, 'boneKnight', 1);
});

// ─── SEQUENCES (COROUTINES) ──────────────────────────────────────────────────
// Anything with steps (a cutscene, a staged boss, a countdown) reads in
// order inside a coroutine instead of a chain of after() callbacks each
// holding one step. `yield wait(n)` pauses for n ticks, and
// `yield waitFor(event)` until a hook fires, evaluating to its payload.
//
// Sequences are cancelled when this file reloads, so saving mid-cutscene
// leaves no generator of the replaced code running. Put anything the
// sequence has to give back in a `finally`, which cancelling runs.

command(
  'countdown',
  { description: 'Demo: a three second countdown, then a shout' },
  ({ player, reply }) => {
    if (!player) return reply('In-game only.');
    coroutine(function* countdown() {
      for (let n = 3; n > 0; n--) {
        sendMessage(player, `${n}...`);
        yield wait(msToTicks(1000));
      }
      sendMessage(player, 'Go!');
    });
  },
);

// The shape a boss fight wants: announce, wait for the thing to actually
// happen, then react. Written with hooks alone this is two handlers and a flag
// in module scope remembering which phase we are in.
command(
  'challenge',
  { description: 'Demo: slay a Skeleton while the challenge stands' },
  ({ player, reply }) => {
    if (!player) return reply('In-game only.');
    coroutine(function* skeletonChallenge() {
      sendMessage(player, 'The Mage raises the staff.');
      yield wait(msToTicks(1500));
      sendMessage(player, 'Prove yourself: slay a Skeleton.');

      // Only this player's kill resumes it: the filter runs on every
      // npcDeath, and one that does not match never wakes the sequence.
      yield waitFor(
        'npcDeath',
        (p) => p.npc.name === 'Skeleton' && p.killer?.name === player.name,
      );

      sendMessage(player, 'The Mage nods.');
      giveExperience(player, 50);
    });
  },
);

// ─── DEATH ───────────────────────────────────────────────────────────────────

on('playerDeath', ({ player, killer }) => {
  const by = killer ? ` by ${killer.name}` : '';
  broadcastMessage(`${player.name} was defeated${by}.`);
});

// ─── ADMIN COMMANDS ──────────────────────────────────────────────────────────

// The engine already registers the operator's own set (heal, tp, kill,
// ban, kick and the rest), and a name registered twice leaves the earlier
// one unreachable, which the server warns about at boot. So a script
// command takes a name of its own, like this one, unless it is meant to
// replace the built-in.
command(
  'give',
  {
    access: Access.ADMIN,
    description: 'Give item to a player: /give <player> <itemId> [qty]',
  },
  ({ args, reply }) => {
    const target = getPlayer(args[0]);
    const itemId = parseInt(args[1]);
    const qty = parseInt(args[2]) || 1;
    if (!target || !itemId)
      return reply('Usage: /give <player> <itemId> [qty]');
    giveItem(target, itemId, qty);
    reply(`Gave ${qty}× item #${itemId} to ${target.name}.`);
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

// ── Anti-farming: make a bot not worth running, and point staff at it ──────
//
// The server already refuses what a bot would do faster than a person: speed,
// range and cooldowns are authoritative. What it cannot see is a client that
// plays without tiring for hours. This does not try to tell bot from human:
// past a kill count per hour, kill XP shrinks, and staff hears about it once.
// Loot still drops; gate it with a lootCondition if that is what gets farmed.
// Counts live in memory over a fixed window, so a reload or the top of the
// hour starts everyone at zero.
//
// const KILLS_PER_HOUR = 300; // tune to how fast your respawns allow
// const ALERT_WEBHOOK = 'https://discord.com/api/webhooks/...';
// const kills = new Map(); // player name -> kills this hour
// const flagged = new Set(); // already reported this hour
//
// every(msToTicks(60 * 60 * 1000), () => {
//   kills.clear();
//   flagged.clear();
// });
//
// on('npcDeath', ({ killer }) => {
//   const n = (kills.get(killer.name) ?? 0) + 1;
//   kills.set(killer.name, n);
//   if (n < KILLS_PER_HOUR || flagged.has(killer.name)) return;
//   flagged.add(killer.name);
//   httpRequest(ALERT_WEBHOOK, {
//     json: { content: `${killer.name}: ${n} kills this hour on ${killer.mapId}` },
//   });
// });
//
// npcDeath fires before the kill's XP is awarded, so the count already includes
// this kill. Each kill past the cap pays less, down to a floor of 10%.
//
// on('beforeXpGain', (ctx) => {
//   if (ctx.source !== 'kill') return;
//   const over = (kills.get(ctx.player.name) ?? 0) - KILLS_PER_HOUR;
//   if (over > 0) ctx.amount *= Math.max(0.1, 1 - over / KILLS_PER_HOUR);
// });

// ── Milestone item reward on level up ────────────────────────────────────────
//
// on('playerLevelUp', ({ player, level }) => {
//   if (level === 10) {
//     giveItem(player, 3, 1); // Short Sword at level 10
//     sendMessage(player, 'You earned a Short Sword for reaching level 10!');
//   }
// });

// ── Double XP on weekends ────────────────────────────────────────────────────
//
// on('beforeXpGain', (ctx) => {
//   const day = new Date().getDay();
//   if (day === 0 || day === 6) ctx.amount *= 2;
// });

// ── Live-ops flags: an admin decides, mid-event, with /flag ─────────────────
//
// The rule above fires on a date; this one fires when someone turns it on:
//   /flag winterEvent true for 180 snow week   (three hours from now)
//   /flag winterEvent true at 20:00 for 120    (tonight at 8, for two hours)
//   /flag winterEvent clear
//
// on('beforeXpGain', (ctx) => {
//   if (flags.enabled('winterEvent')) ctx.amount *= 1.5;
// });
//
// on('npcDeath', ({ killer }) => {
//   if (randomChance(5 * flags.number('dropRate', 1))) {
//     giveItem(killer, Items.Trophy, 1);
//   }
// });
//
// Reading gives the value; the hook gives the moment it changed, which is
// what a scheduled event needs, since nobody is watching at 20:00.
//
// on('liveOpsFlag', ({ name, active }) => {
//   if (name !== 'winterEvent') return;
//   broadcastMessage(active ? 'Winter has arrived!' : 'Winter is over.');
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

// ── Giving and taking items: always check the result ───────────────────────
//
// on('npcDeath', ({ npc, killer }) => {
//   if (!giveItem(killer, Items.Trophy, 1)) {
//     say(`${killer.name}, your bag is full; the trophy was not awarded.`);
//   }
// });
//
// A quest turn-in, atomically: take the fetch items, hand over the reward.
//
// function turnIn(player) {
//   if (!hasItem(player, Items.WolfPelt, 5)) return "Bring me 5 pelts.";
//   if (!canCarry(player, Items.Reward)) return "Free a slot first.";
//   removeItem(player, Items.WolfPelt, 5);
//   giveItem(player, Items.Reward, 1);
//   persistNow(player);
//   return "Thank you!";
// }

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
// attach('cursed-crown', {
//   onEquip({ player })   { setPlayerData(player, 'cursed', true); },
//   onUnequip({ player }) { setPlayerData(player, 'cursed', false); },
// });
//
// An item's type decides which of these it can reach: a consumable is spent
// by onUse, equipment goes through onEquip/onUnequip. Whatever onEquip
// grants, onUnequip has to take back: the player keeps it until the piece
// comes off, and a swap fires onUnequip for the outgoing piece first.
//
// One name can carry several of these at once: a boss that talks, hurts you on
// its tile and drops loot is one attach with three handlers. Registrations are
// dropped when the script reloads, and a name the content references but no
// script registers is reported at boot and when saving in the editor.
//
// ── Exported params: one behavior, many configured instances ───────────────
//
// The behaviors above are each one-of-a-kind: a chest giving a potion and a
// chest giving a sword would be two copies of the same code with one constant
// changed. Declare `params` and the editor renders a FIELD PER PARAM on every
// NPC, item or tile that names the behavior, so the designer configures it:
//
// attach('chest', {
//   params: {
//     itemId:   { type: 'item', label: 'Reward', required: true },
//     quantity: { type: 'number', label: 'How many', default: 1, min: 1 },
//     message:  { type: 'text', default: 'You found something!' },
//     once:     { type: 'boolean', label: 'Only once per player', default: true },
//   },
//   onEnter({ player, tile, params }) {
//     if (params.once && getPlayerData(player, `chest:${tile.tileIndex}`)) return;
//     if (!giveItem(player, params.itemId, params.quantity)) {
//       return sendMessage(player, 'Your bag is full.');
//     }
//     sendMessage(player, params.message);
//     if (params.once) setPlayerData(player, `chest:${tile.tileIndex}`, true);
//   },
// });
//
// Types: 'text' | 'number' | 'boolean' | 'select' (with `options`) | 'item' |
// 'npc' | 'map'. The id types render as content pickers, so nobody has to
// remember that the health potion is item 1.
//
// `ctx.params` only ever contains what you declared, already coerced to the
// declared type and clamped to min/max, so `params.quantity` is a number
// without checking. A stored value that no longer fits the declaration (you
// renamed a param, or changed its type) is reported when the content is saved
// and dropped at runtime rather than passed through.

// ─────────────────────────────────────────────────────────────────────────────
// API REFERENCE (quick look-up; full types in scripts/global.d.ts)
// ─────────────────────────────────────────────────────────────────────────────
//
// HOOKS (on)
//   playerJoin / playerLeave       { player }
//   playerDeath                    { player, killer? }
//   playerLevelUp                  { player, level }
//   npcDeath                       { npc, killer, contributors }  - contributors: who hurt it, largest share first
//   npcRemoved                     { npc }                 - off its map: despawn, map save, a kill that waits to respawn
//   npcInteract                    { player, npc }         - player pressed F
//   tileEnter                      { player, tile, map }
//   itemUse / itemPickup           { player, itemId, quantity? }
//   itemEquip / itemUnequip        { player, itemId, slot }  - a swap fires both
//   chatMessage                    { player, scope, message }
//   playerAttack                   { player, handled }     - set handled = true to own the attack
//   beforeDamage                   { attacker?, target, damage: { value } }  - mutate damage.value
//   afterDamage                    { attacker?, target, damage, lethal }  - after it landed; damage is what it took
//   pvpAllowed                     { attacker, target, mapId, allowed }  - set allowed to open or close a player fight
//   beforeXpGain                   { player, amount, source, base }  - mutate amount; base is the unscaled award; source 'kill' | 'script' | ...
//   customAction                   { player, channel, payload }  - from client sendServerEvent
//   liveOpsFlag                    { name, value, active }  - a flag started or ended (see LIVE-OPS FLAGS)
//   instanceOwner                  { player, mapId, owner }  - set owner: everyone answering the same walks into one copy
//   mapChange                      { mapId }               - a map's tiles changed (editor save, setMapTile)
//   tick                           { tick }                - 20/s; throttle with tick % n
//
// ATTACHED BEHAVIOR (attach): runs only for content naming this id
//   attach(scriptId, { params, onEnter, onInteract, onDeath, onUse, onEquip,
//                      onUnequip })
//   onEnter     { player, tile, map, params }  tile with a `script` trigger
//   onInteract  { player, npc, params }        NPC's "Script behavior" field
//   onDeath     { npc, killer, params }        same NPC, when killed
//   onUse       { player, item, itemId, params }  item's "Script behavior" field
//                                            (consumables - spent on use)
//   onEquip / onUnequip  { player, item, itemId, slot, params }
//                                            same field, on equipment
//   params      { key: { type, label?, help?, required?, default?, min?, max?,
//                        options? } }         a field per key in the editor
//
// PLAYERS
//   getPlayer(name)                → PlayerServer | undefined
//   getPlayers()                   → PlayerServer[]
//   sendMessage(player, text)      private message
//   broadcastMessage(text)         all players
//   healPlayer(player[, amount])   heal amount HP, or to full
//   killPlayer(player)             kill + respawn
//   teleportPlayer(p, mapId, col, row)
//   giveExperience(player, amount) - passes through beforeXpGain
//   dealDamage(target, amount, attacker?)
//   setNameColor(player, color)    - cosmetic name color (undefined to clear)
//   setNameTag(player, tag, color?) - cosmetic tag above name (e.g. guild)
//   setCosmetic(player, field, source, value, priority?) - same fields, one
//                                    source each, highest priority shows; use it
//                                    when more than one system names a player
//   clearCosmetic(player, field, source)  - the next source down shows
//   setChatIgnored(player, names)  - senders this player is not shown (runtime only)
//   getPlayerData(player, key)     - read persisted custom field
//   setPlayerData(player, key, val)- write persisted custom field
//
// NPCS
//   getNearbyNpcs(mapId, x, y, radius)  → RuntimeNpc[]
//   spawnNpc({ mapId, col, row, name?, sprite?, maxHealth?, attack?, behavior? })
//   despawnNpc(npc)
//   moveNpcToward(npc, x, y)       - one tile step (call every ~25 ticks)
//   npc.templateId                 - the content id Npcs.<Name> holds: compare kills
//                                    with it, not npc.id (none on a spawnNpc npc)
//
// MAPS
//   getMapTile(mapId, col, row)    → { blocked, tileIndex, maskIndex?, bank } | null
//   setMapTile(mapId, col, row, { tileIndex?, blocked? }) → boolean
//                                    a door, a bridge; never saved, fires mapChange
//   getMapSize(mapId)              → { cols, rows } | undefined   in tiles
//   canStand(entity, x, y)         → boolean   ask before moving something by hand
//   getMapPvp(mapId)               → 'safe' | 'normal' | 'no-penalty'
//
// CONTENT (what the editors saved; copies, so editing one changes nothing)
//   getItem(id) / getItems()       getArrow(id) / getArrows()
//   getQuest(id) / getQuests()     getDialog(id)
//   getSpells()                    getRecipes()
//   createSpells([...])            seed a module's spells when getSpells() is empty
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
// OUTBOUND HTTP (webhook, alert, your site)
//   httpRequest(url, { method?, headers?, body?, json?, timeoutMs? })
//     → Promise<{ ok, status, body, error? }>   never throws, never rejects
//   httpRequest(WEBHOOK, { json: { content: 'Boss down' } })   fire and forget
//   Refuses this machine and the private network; does not follow redirects.
//
// COMMANDS
//   command(name, handler)
//   command(name, { access, description, canRun }, handler)
//   Access.USER = 0 | Access.MOD = 1 | Access.ADMIN = 2
//
// MODULES
//   use('dialog').show(player, { text, choices? }, onChoice?)
//   use('quest').define(def) / start(p, id) / advance(p, id, n?) / get(p, id)
//   use('magic').defineSpell({ id, name, cost, cooldownMs, cast(player) })
//   use('magic').cast(p, id)           → false if it did not go off: unknown, not p's,
//                                        cooling down, short of mana, or it threw
//   use('magic').setSpells(p, ids?)    what p can cast; undefined = every spell
//   use('magic').learn(p, id)          → false if p could cast it already,
//                                        or p's data refused the longer list;
//                                        throws on an id no spell has
//   use('guild').guildOf(player) / isMember(p, name) / members(name)
//   use('party').partyOf(player) / isMember(p, name) / members(name)
//   provide(name, api)                 publish your own, for use(name) elsewhere
//
// SCHEDULING (ticks, not milliseconds; see below)
//   after(ticks, fn)               → id   run once, `ticks` from now
//   every(ticks, fn)               → id   repeat forever
//   cancel(id)                     stop a scheduled task
//   msToTicks(ms)                  → ticks  e.g. after(msToTicks(3000), fn)
//   Auto-cancelled when the script reloads, so no duplicates on hot reload.
//
// SEQUENCES (a generator that pauses, for anything with steps)
//   coroutine(function* () { ... }) → handle {cancel(), done}
//   yield wait(ticks)              pause, resume on that tick
//   yield waitFor(event, filter?)  pause until a hook fires → its payload
//   Cancelled on reload like the above; `finally` runs, so release things there.
//
// RANDOM (deterministic: Math.random is wired to the same sequence)
//   random()                       → [0, 1)
//   randomInt(maxExclusive)        → integer
//   randomChance(percent)          → boolean, percent is 0-100
//   randomPick(array)              → element | undefined
//
//   Why ticks and why this random: the sim runs on a seeded, tick-driven loop,
//   so replays reproduce a session exactly. Wall-clock timers escape that:
//   the recorder never sees them and a replay drifts. setTimeout/setInterval
//   still work but are deprecated and log a warning. Math.random does not
//   escape: inside a script it IS random(), so the reflex costs nothing.
//
// INVENTORY / ECONOMY (all report what happened; check the result)
//   giveItem(player, itemId, qty?)   → boolean  false = full bag or unknown item
//   removeItem(player, itemId, qty?) → boolean  all-or-nothing; false = too few
//   hasItem(player, itemId, qty?)    → boolean
//   countItem(player, itemId)        → number
//   canCarry(player, itemId)         → boolean  a stack already held always fits
//   moveItem(from, to, itemId, qty?) → { ok, reason? }  atomic between containers
//   exchangeItems(player, inputs, output) → { ok, reason? }  a craft: all or nothing
//   commitInventories(players, change)    → Promise<boolean>  items between
//                                      players, written together or not at all
//   persistNow(...players)           → Promise<boolean>  write now, not on the timer
//   auctions.*                       durable auction escrow (see global.d.ts)
//
//   A container is anything shaped { items, maxCapacity } - player.inventory,
//   or a bank/mailbox you keep in player data. moveItem checks both sides
//   before touching either, so a full destination can never eat the source;
//   `reason` is 'not-enough' | 'no-space' | 'invalid-amount' | 'same-container'.
//
//   Prefer moveItem over removeItem-then-giveItem: the pair can strand items
//   if the second half fails.
//
// DELIVERY: giving an item to a player who may be OFFLINE (returns promises)
//   delivery.queue({ to, itemId, quantity?, meta? }) → { ok, id?, reason? }
//   delivery.list(name) / delivery.count(name)       → what is waiting
//   delivery.claim(player, ids?)                     → moves it into a live
//                                                      inventory, exactly once
//   delivery.cancel(id)                              → drop a queued row
//
//   The claim cannot duplicate or lose the item: it writes the inventory and
//   the record of the claim together. Your side is the send: take the item
//   from the sender and persistNow BEFORE queueing, or a crash makes a copy.
//   The `mail` module is this wrapped in a mailbox, if you want the whole thing.
//
// PERSISTED DATA (real limits; check the result)
//   getPlayerData(player, key)         → value | undefined   returns a COPY
//   setPlayerData(player, key, value)  → boolean  false = refused
//   store.get/set/delete/keys/entries  the same, shared between players
//
//   A read returns a copy, so changing it does not change what is stored:
//     const log = getPlayerData(p, 'log') || [];
//     log.push(x);
//     setPlayerData(p, 'log', log);   // required
//
//   `set` refuses a value too large, a new key past the limit, or a value
//   that cannot be serialized (a circular reference). That is not a matter of
//   taste: a player document over 16MB stops saving, for good.
//
//   Pass `undefined` to clear a key, which is also how to make room once
//   the key limit is reached.
//
// LIVE-OPS FLAGS (read-only here; an admin sets them with /flag)
//   flags.enabled(name)          → boolean  true only for a flag set to true
//   flags.number(name, fallback) → number   fallback when unset or not a number
//   flags.get(name)              → the raw value | undefined
//   on('liveOpsFlag', ({ name, value, active }) => …)   started / ended
//
//   Set from the terminal, the web console or chat. It applies at once (or at
//   the time you schedule), survives a restart, and ends on its own:
//     /flag xpMultiplier 2 for 120 launch weekend
//     /flag bossWeek true at 20:00 for 120     20:00 today, or tomorrow if past
//     /flag bossWeek true at +2h               also +90 (minutes) or +3d
//     /flag bossWeek true at 2026-08-02T20:00
//     /flag xpMultiplier clear
//
//   The hook fires on the **edge**, once per transition and not per boot, so
//   a restart mid-event does not re-spawn the boss. Need the current state at
//   load time? Read `flags.enabled` directly.
//
//   `xpMultiplier` is the one the engine applies by itself; any other name
//   means whatever your script decides it means.
//
// LANGUAGE
//   i18n({ pt: { 'Pet dismissed.': 'Bicho dispensado.' } })  this script's strings
//   t(player, 'Trades: {count}', { count })  → string in the player's language
//   sendMessage and command replies translate on their own; t is for sentences
//   that carry a value.
//
// LOGGING
//   log(...args)   warn(...args)   error(...args)   in the server log
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
