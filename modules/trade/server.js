// Trade module: item swaps between online players. The core inventory is
// untouched; this checks capacity, then moves the items through the core
// give and remove APIs.

const offers = new Map(); // "from->to" -> offer

const keyOf = (from, to) => `${from}->${to}`;
const positiveInt = (value, fallback) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

function itemQuantity(player, itemId) {
  const slot = player.inventory.items.find((entry) => Number(entry.item) === Number(itemId));
  return slot ? slot.quantity : 0;
}

function hasItem(player, itemId, quantity) {
  return itemQuantity(player, itemId) >= quantity;
}

function wouldFit(player, receive, remove) {
  if (!receive) return true;
  const counts = {};
  for (const entry of player.inventory.items) {
    if (entry.quantity > 0) counts[entry.item] = (counts[entry.item] || 0) + entry.quantity;
  }
  if (remove) {
    counts[remove.itemId] = (counts[remove.itemId] || 0) - remove.quantity;
    if (counts[remove.itemId] <= 0) delete counts[remove.itemId];
  }
  if (counts[receive.itemId]) return true;
  return Object.keys(counts).length < player.inventory.maxCapacity;
}

function offersFor(player) {
  return [...offers.values()].filter((offer) => offer.from === player.name || offer.to === player.name);
}

function push(player) {
  sendEvent(player, 'trade:update', { player: player.name, offers: offersFor(player) });
}

function pushOffer(offer) {
  const from = getPlayer(offer.from);
  const to = getPlayer(offer.to);
  if (from) push(from);
  if (to) push(to);
}

function offerTrade(player, targetName, giveItemId, giveQty, wantItemId, wantQty) {
  const target = getPlayer(String(targetName || ''));
  if (!target) return 'Player not found.';
  if (target.name === player.name) return 'You cannot trade with yourself.';

  const give = {
    itemId: positiveInt(giveItemId, 0),
    quantity: positiveInt(giveQty, 1),
  };
  const want =
    wantItemId === undefined || wantItemId === null || wantItemId === ''
      ? undefined
      : { itemId: positiveInt(wantItemId, 0), quantity: positiveInt(wantQty, 1) };

  if (!give.itemId || !hasItem(player, give.itemId, give.quantity)) return 'You do not have that item quantity.';
  if (want && !want.itemId) return 'Invalid requested item.';
  if (!wouldFit(target, give, want)) return `${target.name}'s inventory is full.`;

  const offer = {
    from: player.name,
    to: target.name,
    give,
    want,
    createdAt: Date.now(),
  };
  offers.set(keyOf(offer.from, offer.to), offer);
  pushOffer(offer);
  sendEvent(target, 'trade:offer', offer);
  return `Trade offered to ${target.name}.`;
}

function acceptTrade(player, fromName) {
  const offer = offers.get(keyOf(String(fromName || ''), player.name));
  if (!offer) return 'No trade offer from that player.';

  const from = getPlayer(offer.from);
  const to = getPlayer(offer.to);
  if (!from || !to) {
    offers.delete(keyOf(offer.from, offer.to));
    if (from) push(from);
    if (to) push(to);
    return 'Trade partner is offline.';
  }

  if (!hasItem(from, offer.give.itemId, offer.give.quantity)) return 'Offer is no longer valid.';
  if (offer.want && !hasItem(to, offer.want.itemId, offer.want.quantity)) return 'You do not have the requested item quantity.';
  if (!wouldFit(to, offer.give, offer.want)) return 'Your inventory is full.';
  if (!wouldFit(from, offer.want, offer.give)) return `${from.name}'s inventory is full.`;

  removeItem(from, offer.give.itemId, offer.give.quantity);
  if (offer.want) removeItem(to, offer.want.itemId, offer.want.quantity);
  giveItem(to, offer.give.itemId, offer.give.quantity);
  if (offer.want) giveItem(from, offer.want.itemId, offer.want.quantity);

  offers.delete(keyOf(offer.from, offer.to));
  push(from);
  push(to);
  sendEvent(from, 'trade:complete', offer);
  sendEvent(to, 'trade:complete', offer);
  return 'Trade completed.';
}

function cancelTrade(player, otherName) {
  const other = String(otherName || '');
  const keys = [keyOf(player.name, other), keyOf(other, player.name)];
  let cancelled = false;
  for (const key of keys) {
    const offer = offers.get(key);
    if (!offer) continue;
    offers.delete(key);
    pushOffer(offer);
    cancelled = true;
  }
  if (!cancelled) push(player);
  return cancelled ? 'Trade cancelled.' : 'No trade to cancel.';
}

command(
  'trade',
  { description: 'Trade: /trade offer <player> <item> <qty> [wantItem] [wantQty] | accept|cancel <player>' },
  ({ player, args, reply }) => {
    if (!player) return reply('Trade commands must be used in-game.');
    const sub = String(args[0] || '').toLowerCase();
    if (sub === 'offer') return reply(offerTrade(player, args[1], args[2], args[3], args[4], args[5]));
    if (sub === 'accept') return reply(acceptTrade(player, args[1]));
    if (sub === 'cancel') return reply(cancelTrade(player, args[1]));
    if (sub === 'list') return reply(`Trades: ${offersFor(player).length}`);
    reply('Usage: /trade offer <player> <item> <qty> [wantItem] [wantQty] | accept|cancel <player>');
  },
);

on('customAction', ({ player, channel, payload }) => {
  if (channel === 'trade:offer') {
    offerTrade(player, payload && payload.to, payload && payload.giveItemId, payload && payload.giveQty, payload && payload.wantItemId, payload && payload.wantQty);
  } else if (channel === 'trade:accept') {
    acceptTrade(player, payload && payload.from);
  } else if (channel === 'trade:cancel') {
    cancelTrade(player, payload && payload.player);
  } else if (channel === 'trade:request') {
    push(player);
  }
});

on('playerLeave', ({ player }) => {
  for (const offer of offersFor(player)) {
    offers.delete(keyOf(offer.from, offer.to));
    pushOffer(offer);
  }
});

provide('trade', {
  offer: offerTrade,
  accept: acceptTrade,
  cancel: cancelTrade,
  offersFor,
});

log('Trade module ready.');
