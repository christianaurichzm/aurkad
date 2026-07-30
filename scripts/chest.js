// A chest, written once and configured per tile.
//
// The point is that this file has no ids in it: which item, how many, what the
// message says and whether it can be looted twice are all fields the map editor
// renders from the `params` declaration below, and the values live on the tile.
// Two chests on the seeded map share this behaviour with different settings.

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
  },

  onEnter({ player, tile, map, params }) {
    // Per tile, not per behaviour: two chests must not share one "looted" flag.
    const key = `chest:${map.id}:${tile.tileIndex}:${params.itemId}`;
    if (params.once && getPlayerData(player, key)) return;

    // giveItem reports whether it happened; a full bag would otherwise use up
    // the chest and hand over nothing.
    if (!giveItem(player, params.itemId, params.quantity)) {
      sendMessage(player, 'Your bag is full.');
      return;
    }

    sendMessage(player, params.message);
    if (params.once) setPlayerData(player, key, true);
  },
});
