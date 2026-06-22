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
//   setTimeout(fn, ms)
//   setInterval(fn, ms)
//   log(...args)
//
// Client code subscribes with onServerEvent(channel, handler) and sends with
// sendServerEvent(channel, payload) (handled here via on('customAction', ...)).
//
// Events: playerJoin, playerLeave, playerDeath, playerLevelUp,
//         npcDeath, tileEnter, itemUse, itemPickup, chatMessage,
//         beforeDamage

on('playerJoin', ({ player }) => {
  sendMessage(player, `Welcome to the game, ${player.name}!`);
});

on('playerLevelUp', ({ player, level }) => {
  broadcastMessage(`${player.name} reached level ${level}!`);
});

on('npcDeath', ({ npc, killer }) => {
  log(`${killer.name} defeated ${npc.name}`);
});

// Uncomment to give new players a starter item (use a real item id for 1):
//
// on('playerJoin', ({ player }) => {
//   giveItem(player, 1, 1);
// });

// VIP perks via the per-player data bag (set player.data.vip elsewhere,
// e.g. an admin tool or purchase flow). Gold name + double XP:
//
// on('playerJoin', ({ player }) => {
//   if (getPlayerData(player, 'vip')) {
//     setNameColor(player, 'gold');          // shown above the sprite for everyone
//     sendMessage(player, 'Welcome back, VIP!');
//   }
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
