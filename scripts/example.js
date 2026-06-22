// Game script, run on the server at boot. Saving this file applies the
// changes at once, with no restart.
//
// Available API:
//   on(event, handler)          - listen to a lifecycle event
//   getPlayer(name)             - PlayerServer | undefined
//   getPlayers()                - PlayerServer[]
//   spawnNpc(opts) / despawnNpc(npc) - runtime NPCs (pets, summons, bosses)
//   giveItem(player, id, qty)   - add item to inventory
//   removeItem(player, id, qty) - remove item from inventory
//   healPlayer(player)          - restore full health
//   killPlayer(player)          - kill + respawn
//   teleportPlayer(p, mapId, col, row)
//   sendMessage(player, text)   - private message
//   broadcastMessage(text)      - global chat
//   getPlayerData(player, key)  - read custom per-player data
//   setPlayerData(player, key, value) - write custom per-player data (persisted)
//   store.get/set/delete/keys/entries(scope, ...) - shared persistent store
//   sendEvent(player, channel, payload)     - custom event to one client
//   sendMapEvent(mapId, channel, payload)   - custom event to a map
//   broadcastEvent(channel, payload)        - custom event to all clients
//   command(name, { access }, handler)      - chat (/name) + REPL command
//   use('dialog').show(player, { text, choices }, onChoice) - dialog box (press F)
//   use('quest').define/start/advance/complete/get - quests (quest module)
//   setTimeout(fn, ms)
//   setInterval(fn, ms)
//   log(...args)
//
// Client code subscribes with onServerEvent(channel, handler) and sends with
// sendServerEvent(channel, payload) (handled here via on('customAction', ...)).
//
// Events: playerJoin, playerLeave, playerDeath, playerLevelUp, npcDeath,
//         npcInteract, tileEnter, itemUse, itemPickup, chatMessage,
//         beforeDamage, beforeXpGain, customAction, tick

on('playerJoin', ({ player }) => {
  sendMessage(player, `Welcome to the game, ${player.name}!`);
});

on('playerLevelUp', ({ player, level }) => {
  broadcastMessage(`${player.name} reached level ${level}!`);
});

on('npcDeath', ({ npc, killer }) => {
  log(`${killer.name} defeated ${npc.name}`);
});

// Talk to an NPC: face it and press F. Dialog comes from the dialog module.
const dialog = use('dialog');
on('npcInteract', ({ player, npc }) => {
  if (!dialog) return;
  dialog.show(
    player,
    { text: `${npc.name}: Greetings, traveler. Need anything?`, choices: ['Heal me', 'Nothing'] },
    (choice) => {
      if (choice === 0) {
        healPlayer(player);
        sendMessage(player, 'You feel restored.');
      }
    },
  );
});

// Uncomment to give new players a starter item (use a real item id for 1):
//
// on('playerJoin', ({ player }) => {
//   giveItem(player, 1, 1);
// });

// A kill quest wired from dialog and npcDeath through the quest and dialog
// modules. The quest module tracks progress (shown in the quest log) and
// grants the reward; the script defines and advances it.
//
// const quest = use('quest');
// const dialog = use('dialog');
// quest.define({
//   id: 'goblinHunt', name: 'Goblin Hunt', description: 'Defeat 3 goblins',
//   target: 3, reward: (player) => giveExperience(player, 100),
// });
// on('npcInteract', ({ player, npc }) => {
//   if (npc.name !== 'Quest Giver') return;
//   const q = quest.get(player, 'goblinHunt');
//   if (!q) {
//     dialog.show(player, { text: 'Slay 3 goblins?', choices: ['Accept', 'Decline'] }, (i) => {
//       if (i === 0) quest.start(player, 'goblinHunt');
//     });
//   } else if (q.status === 'completed') {
//     dialog.show(player, { text: 'You have my thanks, hero.' });
//   } else {
//     dialog.show(player, { text: `Progress: ${q.progress}/${q.target}` });
//   }
// });
// on('npcDeath', ({ npc, killer }) => {
//   if (npc.name === 'Goblin') quest.advance(killer, 'goblinHunt', 1);
// });

// VIP, a complete example: grant it with a command, then react to it.
// Run from in-game chat as "/vip Bob" (admins only) or from the terminal
// REPL as "vip Bob" (operator always allowed).
//
// command('vip', { access: Access.ADMIN, description: 'Grant VIP to a player' }, ({ args, reply }) => {
//   const target = getPlayer(args[0]);
//   if (!target) return reply('Usage: vip <player>');
//   setPlayerData(target, 'vip', true);
//   setNameColor(target, 'gold');           // gold name above the sprite, for everyone
//   reply(`${target.name} is now VIP.`);
// });
//
// // Perks: keep the gold name on reconnect, and double all XP.
// on('playerJoin', ({ player }) => {
//   if (getPlayerData(player, 'vip')) setNameColor(player, 'gold');
// });
// on('beforeXpGain', (ctx) => {
//   if (getPlayerData(ctx.player, 'vip')) ctx.amount *= 2;
// });

// Tiny kill leaderboard using the shared store (scope "leaderboard"):
//
// on('npcDeath', ({ killer }) => {
//   const kills = (store.get('leaderboard', killer.name) ?? 0) + 1;
//   store.set('leaderboard', killer.name, kills);
//   if (kills === 100) broadcastMessage(`${killer.name} reached 100 kills!`);
// });

// Custom events: client asks for its kill count, server replies on a channel.
// (client: sendServerEvent('stats:request'); onServerEvent('stats:reply', ...))
//
// on('customAction', ({ player, channel }) => {
//   if (channel !== 'stats:request') return;
//   const kills = store.get('leaderboard', player.name) ?? 0;
//   sendEvent(player, 'stats:reply', { kills });
// });

// Uncomment to enable double damage on weekends:
//
// on('beforeDamage', ({ damage }) => {
//   const day = new Date().getDay();
//   if (day === 0 || day === 6) damage.value *= 2;
// });

// Tick: runs every game tick (~20/sec), the base for pets, projectiles,
// damage over time and timed buffs. Throttle with the tick number.
//
// on('tick', ({ tick }) => {
//   if (tick % 20 !== 0) return;        // ~once per second
//   for (const p of getPlayers()) {
//     // e.g. a regen buff, a pet step, a poison tick...
//   }
// });

// Pet: spawn a follower that walks toward its owner each tick, and clean
// it up when they leave, with spawnNpc, the tick hook and per-player data.
//
// const pets = {};
// on('playerJoin', ({ player }) => {
//   pets[player.id] = spawnNpc({ mapId: player.mapId, col: 1, row: 1, name: player.name + "'s Pet" });
// });
// on('playerLeave', ({ player }) => {
//   if (pets[player.id]) { despawnNpc(pets[player.id]); delete pets[player.id]; }
// });
// on('tick', ({ tick }) => {
//   if (tick % 4 !== 0) return;                 // move ~5x/sec
//   for (const p of getPlayers()) {
//     const pet = pets[p.id];
//     if (!pet) continue;
//     if (pet.position.x < p.position.x) pet.position.x += 4;
//     else if (pet.position.x > p.position.x) pet.position.x -= 4;
//     if (pet.position.y < p.position.y) pet.position.y += 4;
//     else if (pet.position.y > p.position.y) pet.position.y -= 4;
//   }
// });
