// Game script, run on the server at boot. Saving this file applies the
// changes at once, with no restart.
//
// Available API:
//   on(event, handler)          - listen to a lifecycle event
//   getPlayer(name)             - PlayerServer | undefined
//   getPlayers()                - PlayerServer[]
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
//   showDialog(player, { text, choices }, onChoice) - dialog box (press F at an NPC)
//   setTimeout(fn, ms)
//   setInterval(fn, ms)
//   log(...args)
//
// Client code subscribes with onServerEvent(channel, handler) and sends with
// sendServerEvent(channel, payload) (handled here via on('customAction', ...)).
//
// Events: playerJoin, playerLeave, playerDeath, playerLevelUp, npcDeath,
//         npcInteract, tileEnter, itemUse, itemPickup, chatMessage,
//         beforeDamage, beforeXpGain, customAction

on('playerJoin', ({ player }) => {
  sendMessage(player, `Welcome to the game, ${player.name}!`);
});

on('playerLevelUp', ({ player, level }) => {
  broadcastMessage(`${player.name} reached level ${level}!`);
});

on('npcDeath', ({ npc, killer }) => {
  log(`${killer.name} defeated ${npc.name}`);
});

// Talk to an NPC: face it and press F. The server decides what to say; the
// engine renders the box and routes the choice back to onChoice.
on('npcInteract', ({ player, npc }) => {
  showDialog(
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
