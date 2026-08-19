// @ts-check
// Auction house: selling to somebody who is not online. A module, not
// core, as both halves of a sale are atomic engine operations:
//
//   - the buyer pays with `exchangeItems`, coins out and item in as one
//     economy operation, so a full bag cannot cost the price and a crash
//     cannot pay twice.
//   - the seller is paid through the delivery queue, which reaches a
//     player who is not connected.
//
// Listing is not atomic: `removeItem` takes the item and the listing is
// written, two writes, ordered to lose rather than duplicate. The listing
// is written `pending`, the item taken, the seller persisted, and only
// then the listing marked `active`. A crash before the persist leaves the
// item and a pending listing the next boot drops; one between the persist
// and the promotion loses the item. A duplicate would be worse, as it
// defeats the economy census.
//
// The sale runs the same way: the buyer gets the item, then the seller's
// coins are queued, so a crash between costs the seller a payment rather
// than paying for an item nobody got.

i18n({
  pt: {
    'Auction commands must be used in-game.':
      'Os comandos de leilão só funcionam dentro do jogo.',
    'Usage: /auction list <itemId> <quantity> <price> | cancel <id> | mine':
      'Uso: /auction list <itemId> <quantidade> <preço> | cancel <id> | mine',
    'No such item.': 'Item inexistente.',
    'That item cannot be sold.': 'Esse item não pode ser vendido.',
    'You do not have that many.': 'Você não tem essa quantidade.',
    'The price has to be at least 1.': 'O preço tem de ser pelo menos 1.',
    'You already have {count} listings.': 'Você já tem {count} anúncios.',
    'Could not take the item, so nothing was listed.':
      'Não foi possível retirar o item, então nada foi anunciado.',
    'Listed {quantity}x {item} for {price}.':
      'Anunciado {quantity}x {item} por {price}.',
    'No such listing.': 'Anúncio inexistente.',
    'That listing is not yours.': 'Esse anúncio não é seu.',
    'Cancelled, and the item is in your mailbox.':
      'Cancelado, e o item está na sua caixa de correio.',
    'You cannot buy your own listing.':
      'Você não pode comprar o seu próprio anúncio.',
    'You need {price} to buy that.':
      'Você precisa de {price} para comprar isso.',
    'Your bag is full.': 'Sua bolsa está cheia.',
    'Bought {quantity}x {item} for {price}.':
      'Comprado {quantity}x {item} por {price}.',
    '{buyer} bought your {quantity}x {item} for {price}.':
      '{buyer} comprou seus {quantity}x {item} por {price}.',
    'Your listing of {quantity}x {item} expired.':
      'Seu anúncio de {quantity}x {item} expirou.',
    'Nothing is up for auction.': 'Nada está em leilão.',
    'You have no listings.': 'Você não tem anúncios.',
    '#{id} {quantity}x {item} - {price} (by {seller})':
      '#{id} {quantity}x {item} - {price} (de {seller})',
  },
});

const num = (value, fallback) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

const currencyItemId = Math.max(
  1,
  Math.floor(num(config && config.currencyItemId, 3)),
);
const durationMs =
  Math.max(1, num(config && config.durationHours, 48)) * 3600_000;
const maxPerPlayer = Math.max(
  1,
  Math.floor(num(config && config.maxListingsPerPlayer, 10)),
);
const feePercent = Math.min(
  90,
  Math.max(0, num(config && config.feePercent, 0)),
);
const sweepTicks = msToTicks(
  Math.max(5, num(config && config.sweepSeconds, 60)) * 1000,
);

const SCOPE = 'auction';

const read = (id) => /** @type {any} */ (store.get(SCOPE, id));
const write = (listing) => store.set(SCOPE, listing.id, listing);
const drop = (id) => store.delete(SCOPE, id);

function all() {
  return store
    .keys(SCOPE)
    .map(read)
    .filter((listing) => listing && listing.state === 'active');
}

const itemName = (itemId) => {
  const item = getItem(itemId);
  return item ? item.name : `#${itemId}`;
};

const view = (listing) => ({
  id: listing.id,
  seller: listing.seller,
  itemId: listing.itemId,
  item: itemName(listing.itemId),
  quantity: listing.quantity,
  price: listing.price,
  expiresAt: listing.expiresAt,
});

/**
 * What this player could put up. Names travel with it for the same reason the
 * trade module sends them: the client has no item catalogue, and a sell form
 * listing raw ids is a form nobody can use.
 */
function sellable(player) {
  const totals = new Map();
  for (const entry of player.inventory.items) {
    const item = getItem(entry.item);
    if (!item || item.bound) continue;
    totals.set(entry.item, (totals.get(entry.item) || 0) + entry.quantity);
  }
  return [...totals].map(([itemId, quantity]) => ({
    itemId,
    item: itemName(itemId),
    quantity,
  }));
}

function push(player) {
  const listings = all();
  sendEvent(player, 'auction:update', {
    listings: listings.map(view),
    mine: listings.filter((l) => l.seller === player.name).map((l) => l.id),
    inventory: sellable(player),
    currencyItemId,
    currency: itemName(currencyItemId),
    feePercent,
  });
}

const pushAll = () => {
  for (const player of getPlayers()) push(player);
};

/** Back to the seller through the queue, because they may be long gone. */
async function returnToSeller(listing, reason) {
  drop(listing.id);
  await delivery.queue({
    to: listing.seller,
    itemId: listing.itemId,
    quantity: listing.quantity,
  });
  const seller = getPlayer(listing.seller);
  if (seller && reason)
    sendMessage(
      seller,
      t(seller, reason, {
        quantity: listing.quantity,
        item: itemName(listing.itemId),
      }),
    );
}

let counter = 0;
const nextId = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

function list(player, rawItemId, rawQuantity, rawPrice) {
  const itemId = Math.floor(num(rawItemId, 0));
  const quantity = Math.max(1, Math.floor(num(rawQuantity, 1)));
  const price = Math.floor(num(rawPrice, 0));

  const item = getItem(itemId);
  if (!item) return 'No such item.';
  // A bound item is one the game said stays with its owner; an auction is the
  // longest way around that rule.
  if (item.bound) return 'That item cannot be sold.';
  if (price < 1) return 'The price has to be at least 1.';
  if (!hasItem(player, itemId, quantity)) return 'You do not have that many.';

  const mine = all().filter((l) => l.seller === player.name);
  if (mine.length >= maxPerPlayer)
    return t(player, 'You already have {count} listings.', {
      count: mine.length,
    });

  // Written before the item moves: a crash here leaves a pending row the boot
  // sweep drops, and the item never left the seller.
  const listing = {
    id: nextId(),
    state: 'pending',
    seller: player.name,
    itemId,
    quantity,
    price,
    listedAt: Date.now(),
    expiresAt: Date.now() + durationMs,
  };
  if (!write(listing)) return 'Could not take the item, so nothing was listed.';

  if (!removeItem(player, itemId, quantity)) {
    drop(listing.id);
    return 'You do not have that many.';
  }
  persistNow(player);

  listing.state = 'active';
  write(listing);
  pushAll();
  return t(player, 'Listed {quantity}x {item} for {price}.', {
    quantity,
    item: item.name,
    price,
  });
}

async function cancelListing(player, id) {
  const listing = read(String(id || ''));
  if (!listing || listing.state !== 'active') return 'No such listing.';
  if (listing.seller !== player.name) return 'That listing is not yours.';

  await returnToSeller(listing);
  pushAll();
  return 'Cancelled, and the item is in your mailbox.';
}

async function buy(player, id) {
  const listing = read(String(id || ''));
  if (!listing || listing.state !== 'active') return 'No such listing.';
  if (listing.seller === player.name) return 'You cannot buy your own listing.';
  if (!hasItem(player, currencyItemId, listing.price))
    return t(player, 'You need {price} to buy that.', { price: listing.price });

  // Reserved before the money moves, so two buyers in the same tick cannot both
  // pass the check above and both be charged.
  listing.state = 'sold';
  write(listing);

  // The one indivisible step: the coins leave and the item arrives together.
  const paid = exchangeItems(
    player,
    [{ itemId: currencyItemId, quantity: listing.price }],
    { itemId: listing.itemId, quantity: listing.quantity },
  );
  if (!paid.ok) {
    listing.state = 'active';
    write(listing);
    return paid.reason === 'no-space'
      ? 'Your bag is full.'
      : t(player, 'You need {price} to buy that.', { price: listing.price });
  }
  persistNow(player);

  const fee = Math.floor((listing.price * feePercent) / 100);
  const payout = Math.max(0, listing.price - fee);
  if (payout > 0)
    await delivery.queue({
      to: listing.seller,
      itemId: currencyItemId,
      quantity: payout,
    });
  drop(listing.id);

  const seller = getPlayer(listing.seller);
  if (seller)
    sendMessage(
      seller,
      t(seller, '{buyer} bought your {quantity}x {item} for {price}.', {
        buyer: player.name,
        quantity: listing.quantity,
        item: itemName(listing.itemId),
        price: payout,
      }),
    );

  pushAll();
  return t(player, 'Bought {quantity}x {item} for {price}.', {
    quantity: listing.quantity,
    item: itemName(listing.itemId),
    price: listing.price,
  });
}

/** A pending row is a crash between write and debit: the item never left. */
function dropPending() {
  for (const id of store.keys(SCOPE)) {
    const listing = read(id);
    if (listing && listing.state === 'pending') drop(id);
  }
}

every(sweepTicks, () => {
  const now = Date.now();
  for (const listing of all()) {
    if (listing.expiresAt <= now)
      void returnToSeller(
        listing,
        'Your listing of {quantity}x {item} expired.',
      );
  }
});

on('customAction', ({ player, channel, payload }) => {
  const data = /** @type {any} */ (payload);
  if (channel === 'auction:request') push(player);
  else if (channel === 'auction:list')
    sendMessage(
      player,
      list(
        player,
        data && data.itemId,
        data && data.quantity,
        data && data.price,
      ),
    );
  else if (channel === 'auction:buy')
    void buy(player, data && data.id).then((msg) => sendMessage(player, msg));
  else if (channel === 'auction:cancel')
    void cancelListing(player, data && data.id).then((msg) =>
      sendMessage(player, msg),
    );
});

command(
  'auction',
  {
    description:
      'Auction: /auction list <itemId> <qty> <price> | cancel <id> | mine',
  },
  ({ player, args, reply }) => {
    if (!player) return reply('Auction commands must be used in-game.');
    const sub = String(args[0] || '').toLowerCase();

    if (sub === 'list') return reply(list(player, args[1], args[2], args[3]));
    if (sub === 'cancel')
      return void cancelListing(player, args[1]).then((msg) => reply(msg));
    if (sub === 'buy')
      return void buy(player, args[1]).then((msg) => reply(msg));
    if (sub === 'mine' || sub === '') {
      const listings =
        sub === 'mine' ? all().filter((l) => l.seller === player.name) : all();
      if (listings.length === 0)
        return reply(
          sub === 'mine'
            ? 'You have no listings.'
            : 'Nothing is up for auction.',
        );
      for (const listing of listings.slice(0, 20))
        reply(
          t(player, '#{id} {quantity}x {item} - {price} (by {seller})', {
            id: listing.id,
            quantity: listing.quantity,
            item: itemName(listing.itemId),
            price: listing.price,
            seller: listing.seller,
          }),
        );
      return;
    }
    reply(
      'Usage: /auction list <itemId> <quantity> <price> | cancel <id> | mine',
    );
  },
);

provide('auction', {
  listings: () => all().map(view),
  list,
  buy,
  cancel: cancelListing,
  /**
   * Ends a listing without a sale, the item going back to the seller: a
   * season reset, moderation.
   */
  withdraw: (id) => {
    const listing = read(String(id));
    return listing ? returnToSeller(listing) : Promise.resolve();
  },
});

dropPending();
log(
  `Auction module ready (currency=${currencyItemId}, ${durationMs / 3600_000}h, fee=${feePercent}%).`,
);
