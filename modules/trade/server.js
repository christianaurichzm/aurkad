// @ts-check
// Trade module: item swaps between online players. The core inventory is
// untouched; this checks capacity, then moves the items through the core
// give and remove APIs.

i18n({
  pt: {
    'Player not found.': 'Jogador não encontrado.',
    'You cannot trade with yourself.': 'Você não pode trocar consigo mesmo.',
    'You must be in the same map to trade.':
      'Vocês precisam estar no mesmo mapa para trocar.',
    'You do not have that item quantity.': 'Você não tem essa quantidade.',
    'That item is bound and cannot be traded.':
      'Esse item é vinculado e não pode ser trocado.',
    'Invalid requested item.': 'Item pedido inválido.',
    'The requested item is bound and cannot be traded.':
      'O item pedido é vinculado e não pode ser trocado.',
    "{player}'s inventory is full.": 'O inventário de {player} está cheio.',
    'Trade offered to {player}.': 'Troca oferecida a {player}.',
    'No trade offer from that player.': 'Nenhuma oferta desse jogador.',
    'Trade partner is offline.': 'O outro jogador está fora do jogo.',
    'Offer is no longer valid.': 'A oferta não vale mais.',
    'You do not have the requested item quantity.':
      'Você não tem a quantidade pedida.',
    'Your inventory is full.': 'Seu inventário está cheio.',
    'Trade completed.': 'Troca concluída.',
    'Trade cancelled.': 'Troca cancelada.',
    'No trade to cancel.': 'Nenhuma troca para cancelar.',
    'Trade commands must be used in-game.':
      'Os comandos de troca só funcionam dentro do jogo.',
    'Trades: {count}': 'Trocas: {count}',
    'Usage: /trade offer <player> <item> <qty> [wantItem] [wantQty] | accept|cancel <player>':
      'Uso: /trade offer <jogador> <item> <qtd> [itemDesejado] [qtdDesejada] | accept|cancel <jogador>',
  },
});

const offers = new Map(); // "from->to" -> offer

// An action's answer: whether it happened and the sentence saying so,
// which the window needs to tell apart.
const done = (message) => ({ ok: true, message });
const refused = (message) => ({ ok: false, message });

/** One side of an offer, with what the window draws it from. */
function stack(itemId, quantity) {
  const info = getItem(itemId);
  return {
    itemId,
    quantity,
    name: info ? info.name : String(itemId),
    sprite: info ? info.sprite : 0,
  };
}

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
  sendEvent(player, 'trade:update', {
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
  const target = getPlayer(String(targetName || ''));
  if (!target) return refused('Player not found.');
  if (target.name === player.name)
    return refused('You cannot trade with yourself.');
  if (target.mapId !== player.mapId)
    return refused('You must be in the same map to trade.');

  const giveId = positiveInt(giveItemId, 0);
  const giveInfo = getItem(giveId);
  const give = stack(giveId, positiveInt(giveQty, 1));
  const wantId =
    wantItemId === undefined || wantItemId === null || wantItemId === ''
      ? 0
      : positiveInt(wantItemId, 0);
  const wantInfo = wantId ? getItem(wantId) : null;
  const want = wantId ? stack(wantId, positiveInt(wantQty, 1)) : undefined;

  if (!give.itemId || !hasItem(player, give.itemId, give.quantity))
    return refused('You do not have that item quantity.');
  if (giveInfo && giveInfo.bound)
    return refused('That item is bound and cannot be traded.');
  if (want && !want.itemId) return refused('Invalid requested item.');
  if (want && wantInfo && wantInfo.bound)
    return refused('The requested item is bound and cannot be traded.');
  if (!wouldFit(target, give, want))
    return refused(
      t(player, "{player}'s inventory is full.", {
        player: target.name,
      }),
    );

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
  return done(t(player, 'Trade offered to {player}.', { player: target.name }));
}

function acceptTrade(player, fromName) {
  const offer = offers.get(keyOf(String(fromName || ''), player.name));
  if (!offer) return refused('No trade offer from that player.');

  const from = getPlayer(offer.from);
  const to = getPlayer(offer.to);
  if (!from || !to) {
    offers.delete(keyOf(offer.from, offer.to));
    if (from) push(from);
    if (to) push(to);
    return refused('Trade partner is offline.');
  }

  if (!hasItem(from, offer.give.itemId, offer.give.quantity))
    return refused('Offer is no longer valid.');
  // Re-check bound at accept: the item may have been edited after the offer.
  const giveInfo = getItem(offer.give.itemId);
  const wantInfo = offer.want && getItem(offer.want.itemId);
  if ((giveInfo && giveInfo.bound) || (wantInfo && wantInfo.bound)) {
    offers.delete(keyOf(offer.from, offer.to));
    push(from);
    push(to);
    return refused('Offer is no longer valid.');
  }
  if (offer.want && !hasItem(to, offer.want.itemId, offer.want.quantity))
    return refused('You do not have the requested item quantity.');
  if (!wouldFit(to, offer.give, offer.want))
    return refused('Your inventory is full.');
  if (!wouldFit(from, offer.want, offer.give))
    return refused(
      t(player, "{player}'s inventory is full.", { player: from.name }),
    );

  // Each leg is atomic on its own. The checks above are what make the pair
  // safe: both sides are known to have the goods and the room before the first
  // one moves, so the second cannot fail and strand the first.
  const gave = moveItem(
    from.inventory,
    to.inventory,
    offer.give.itemId,
    offer.give.quantity,
  );
  if (!gave.ok) return refused('Offer is no longer valid.');

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
      return refused('You do not have the requested item quantity.');
    }
  }
  persistNow(from, to);

  offers.delete(keyOf(offer.from, offer.to));
  push(from);
  push(to);
  sendEvent(from, 'trade:complete', offer);
  sendEvent(to, 'trade:complete', offer);
  return done('Trade completed.');
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
  return cancelled ? done('Trade cancelled.') : refused('No trade to cancel.');
}

command(
  'trade',
  {
    description:
      'Trade: /trade offer <player> <item> <qty> [wantItem] [wantQty] | accept|cancel <player>',
  },
  ({ player, args, reply }) => {
    if (!player) return reply('Trade commands must be used in-game.');
    const sub = String(args[0] || '').toLowerCase();
    if (sub === 'offer')
      return reply(
        offerTrade(player, args[1], args[2], args[3], args[4], args[5]).message,
      );
    if (sub === 'accept') return reply(acceptTrade(player, args[1]).message);
    if (sub === 'cancel') return reply(cancelTrade(player, args[1]).message);
    if (sub === 'list')
      return reply(
        t(player, 'Trades: {count}', { count: offersFor(player).length }),
      );
    reply(
      'Usage: /trade offer <player> <item> <qty> [wantItem] [wantQty] | accept|cancel <player>',
    );
  },
);

// The window has no chat line, so answers go back on their own channel in
// the player's language.
function answer(player, result) {
  sendEvent(player, 'trade:result', {
    ok: result.ok,
    message: t(player, result.message),
  });
}

on('customAction', ({ player, channel, payload }) => {
  const data = /** @type {any} */ (payload) || {};
  if (channel === 'trade:offer') {
    answer(
      player,
      offerTrade(
        player,
        data.to,
        data.giveItemId,
        data.giveQty,
        data.wantItemId,
        data.wantQty,
      ),
    );
  } else if (channel === 'trade:accept') {
    answer(player, acceptTrade(player, data.from));
  } else if (channel === 'trade:cancel') {
    answer(player, cancelTrade(player, data.player));
  } else if (channel === 'trade:request') {
    push(player);
  } else if (channel === 'trade:items') {
    // Everything that may change hands, but not what the other player
    // carries, which would expose their bag. Money first, then by name.
    sendEvent(player, 'trade:items', {
      items: getItems()
        .filter((item) => !item.bound)
        .sort(
          (a, b) =>
            Number(b.type === 'money') - Number(a.type === 'money') ||
            a.name.localeCompare(b.name),
        )
        .map(({ id, name, sprite, type, effects }) => ({
          id,
          name,
          sprite,
          type,
          effects,
        })),
    });
  }
});

on('playerLeave', ({ player }) => {
  for (const offer of offersFor(player)) {
    offers.delete(keyOf(offer.from, offer.to));
    pushOffer(offer);
  }
});

// Another module or a script gets the sentence alone.
provide('trade', {
  offer: (...args) => offerTrade(...args).message,
  accept: (...args) => acceptTrade(...args).message,
  cancel: (...args) => cancelTrade(...args).message,
  offersFor,
});

log('Trade module ready.');
