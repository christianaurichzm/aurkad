// @ts-check
// Trade module: item swaps between online players. The core inventory is
// untouched; this checks capacity, then moves the items through the core
// give and remove APIs.

const offers = new Map(); // "from->to" -> offer

const keyOf = (from, to) => `${from}->${to}`;
const positiveInt = (value, fallback) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * Whether `player` can receive `receive` while `remove` leaves them in the
 * same swap, simulated on a copy since the outgoing item may free the slot.
 */
function wouldFit(player, receive, remove) {
  if (!receive) return true;
  const simulated = {
    maxCapacity: player.inventory.maxCapacity,
    items: player.inventory.items.map((entry) => ({ ...entry })),
  };
  if (remove) {
    moveItem(simulated, scratch(), remove.itemId, remove.quantity);
  }
  return moveItem(scratch(receive), simulated, receive.itemId, receive.quantity)
    .ok;
}

/** Throwaway container for the simulation above. */
function scratch(hold) {
  return {
    maxCapacity: 99,
    items: hold ? [{ item: hold.itemId, quantity: hold.quantity }] : [],
  };
}

function offersFor(player) {
  return [...offers.values()].filter(
    (offer) => offer.from === player.name || offer.to === player.name,
  );
}

function push(player) {
  sendEvent(player, "trade:update", {
    player: player.name,
    offers: offersFor(player),
  });
}

function pushOffer(offer) {
  const from = getPlayer(offer.from);
  const to = getPlayer(offer.to);
  if (from) push(from);
  if (to) push(to);
}

function offerTrade(
  player,
  targetName,
  giveItemId,
  giveQty,
  wantItemId,
  wantQty,
) {
  const target = getPlayer(String(targetName || ""));
  if (!target) return "Player not found.";
  if (target.name === player.name) return "You cannot trade with yourself.";
  if (target.mapId !== player.mapId)
    return "You must be in the same map to trade.";

  const giveId = positiveInt(giveItemId, 0);
  const giveInfo = getItem && getItem(giveId);
  const give = {
    itemId: giveId,
    quantity: positiveInt(giveQty, 1),
    name: giveInfo ? giveInfo.name : String(giveId),
  };
  const wantId =
    wantItemId === undefined || wantItemId === null || wantItemId === ""
      ? 0
      : positiveInt(wantItemId, 0);
  const wantInfo = wantId ? getItem && getItem(wantId) : null;
  const want = wantId
    ? {
        itemId: wantId,
        quantity: positiveInt(wantQty, 1),
        name: wantInfo ? wantInfo.name : String(wantId),
      }
    : undefined;

  if (!give.itemId || !hasItem(player, give.itemId, give.quantity))
    return "You do not have that item quantity.";
  if (giveInfo && giveInfo.bound)
    return "That item is bound and cannot be traded.";
  if (want && !want.itemId) return "Invalid requested item.";
  if (want && wantInfo && wantInfo.bound)
    return "The requested item is bound and cannot be traded.";
  if (!wouldFit(target, give, want))
    return `${target.name}'s inventory is full.`;

  const offer = {
    from: player.name,
    to: target.name,
    give,
    want,
    createdAt: Date.now(),
  };
  offers.set(keyOf(offer.from, offer.to), offer);
  pushOffer(offer);
  sendEvent(target, "trade:offer", offer);
  return `Trade offered to ${target.name}.`;
}

function acceptTrade(player, fromName) {
  const offer = offers.get(keyOf(String(fromName || ""), player.name));
  if (!offer) return "No trade offer from that player.";

  const from = getPlayer(offer.from);
  const to = getPlayer(offer.to);
  if (!from || !to) {
    offers.delete(keyOf(offer.from, offer.to));
    if (from) push(from);
    if (to) push(to);
    return "Trade partner is offline.";
  }

  if (!hasItem(from, offer.give.itemId, offer.give.quantity))
    return "Offer is no longer valid.";
  // Re-check bound at accept: the item may have been edited after the offer.
  const giveInfo = getItem && getItem(offer.give.itemId);
  const wantInfo = offer.want && getItem && getItem(offer.want.itemId);
  if ((giveInfo && giveInfo.bound) || (wantInfo && wantInfo.bound)) {
    offers.delete(keyOf(offer.from, offer.to));
    push(from);
    push(to);
    return "Offer is no longer valid.";
  }
  if (offer.want && !hasItem(to, offer.want.itemId, offer.want.quantity))
    return "You do not have the requested item quantity.";
  if (!wouldFit(to, offer.give, offer.want)) return "Your inventory is full.";
  if (!wouldFit(from, offer.want, offer.give))
    return `${from.name}'s inventory is full.`;

  // Each leg is atomic on its own. The checks above are what make the pair
  // safe: both sides are known to have the goods and the room before the first
  // one moves, so the second cannot fail and strand the first.
  const gave = moveItem(
    from.inventory,
    to.inventory,
    offer.give.itemId,
    offer.give.quantity,
  );
  if (!gave.ok) return "Offer is no longer valid.";

  if (offer.want) {
    const paid = moveItem(
      to.inventory,
      from.inventory,
      offer.want.itemId,
      offer.want.quantity,
    );
    if (!paid.ok) {
      // Put the first leg back rather than leaving a one-sided trade.
      moveItem(
        to.inventory,
        from.inventory,
        offer.give.itemId,
        offer.give.quantity,
      );
      return "You do not have the requested item quantity.";
    }
  }
  persistNow(from, to);

  offers.delete(keyOf(offer.from, offer.to));
  push(from);
  push(to);
  sendEvent(from, "trade:complete", offer);
  sendEvent(to, "trade:complete", offer);
  return "Trade completed.";
}

function cancelTrade(player, otherName) {
  const other = String(otherName || "");
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
  return cancelled ? "Trade cancelled." : "No trade to cancel.";
}

command(
  "trade",
  {
    description:
      "Trade: /trade offer <player> <item> <qty> [wantItem] [wantQty] | accept|cancel <player>",
  },
  ({ player, args, reply }) => {
    if (!player) return reply("Trade commands must be used in-game.");
    const sub = String(args[0] || "").toLowerCase();
    if (sub === "offer")
      return reply(
        offerTrade(player, args[1], args[2], args[3], args[4], args[5]),
      );
    if (sub === "accept") return reply(acceptTrade(player, args[1]));
    if (sub === "cancel") return reply(cancelTrade(player, args[1]));
    if (sub === "list") return reply(`Trades: ${offersFor(player).length}`);
    reply(
      "Usage: /trade offer <player> <item> <qty> [wantItem] [wantQty] | accept|cancel <player>",
    );
  },
);

on("customAction", ({ player, channel, payload }) => {
  const data = /** @type {any} */ (payload);
  if (channel === "trade:offer") {
    offerTrade(
      player,
      data && data.to,
      data && data.giveItemId,
      data && data.giveQty,
      data && data.wantItemId,
      data && data.wantQty,
    );
  } else if (channel === "trade:accept") {
    acceptTrade(player, data && data.from);
  } else if (channel === "trade:cancel") {
    cancelTrade(player, data && data.player);
  } else if (channel === "trade:request") {
    push(player);
  }
});

on("playerLeave", ({ player }) => {
  for (const offer of offersFor(player)) {
    offers.delete(keyOf(offer.from, offer.to));
    pushOffer(offer);
  }
});

provide("trade", {
  offer: offerTrade,
  accept: acceptTrade,
  cancel: cancelTrade,
  offersFor,
});

log("Trade module ready.");
