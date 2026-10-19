// A chest, written once and configured per tile or per npc. This file has
// no ids: the item, the amount, the message and whether it can be looted
// twice are fields the editor renders from `params` below, and the values
// live on the tile or npc. Name `chest` in a tile's script trigger or an
// npc's Script behavior field to place one.
//
// On a tile it is looted by stepping on it. On an npc it is solid and
// opened with the interact key, and `openSprite` is what it shows after.

attach('chest', {
  params: {
    itemId: { type: 'item', label: 'Reward', required: true },
    quantity: { type: 'number', label: 'How many', default: 1, min: 1 },
    message: {
      type: 'text',
      label: 'Message',
      default: 'You found something!',
    },
    once: {
      type: 'boolean',
      label: 'Only once per player',
      help: 'Remembers on the player, so it survives a relog.',
      default: false,
    },
    openSprite: {
      type: 'number',
      label: 'Sprite once opened',
      help: 'Npc chests only: what it shows after it is opened.',
      min: 0,
    },
  },

  onEnter({ player, map, params }) {
    // Per tile, not per behaviour: two chests must not share one "looted" flag.
    // The player is standing on it, so where they stand is where it is.
    const col = Math.round(player.position.x / TILE_SIZE);
    const row = Math.round(player.position.y / TILE_SIZE);
    loot(player, `chest:${map.id}:${row}:${col}:${params.itemId}`, params);
  },

  onInteract({ player, npc, params }) {
    // A spawned npc's id carries its map and tile, so it is per chest already.
    if (!loot(player, `chest:${npc.id}`, params)) return;
    if (params.openSprite !== undefined) npc.sprite = params.openSprite;
  },
});

/** Hands the reward over; false when there was nothing to take. */
function loot(player, key, params) {
  if (params.once) {
    if (getPlayerData(player, key)) return false;
    // Marked before the item moves: a player at the data limit is refused the
    // mark, and a chest that paid out unmarked would pay again on every step.
    if (!setPlayerData(player, key, true)) return false;
  }

  // giveItem reports whether it happened; a full bag would otherwise use up
  // the chest and hand over nothing.
  if (!giveItem(player, params.itemId, params.quantity)) {
    if (params.once) setPlayerData(player, key, undefined);
    sendMessage(player, 'Your bag is full.');
    return false;
  }

  sendMessage(player, params.message);
  return true;
}
