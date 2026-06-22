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
//   setTimeout(fn, ms)
//   setInterval(fn, ms)
//   log(...args)
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

// Uncomment to enable double damage on weekends:
//
// on('beforeDamage', ({ damage }) => {
//   const day = new Date().getDay();
//   if (day === 0 || day === 6) damage.value *= 2;
// });
