// @ts-check
// Gameplay policy and presentation; escrow commits are owned by the engine.

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
    'Your mailbox has no room for it, so the listing stays up.':
      'Sua caixa de correio não tem espaço para ele, então o anúncio continua.',
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

const itemName = (itemId) => getItem(itemId)?.name || `#${itemId}`;
const view = (listing) => ({
  id: listing.id,
  seller: listing.seller,
  itemId: listing.itemId,
  item: itemName(listing.itemId),
  quantity: listing.quantity,
  price: listing.price,
  expiresAt: listing.expiresAt,
});

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

async function push(player) {
  const listings = await auctions.list();
  sendEvent(player, 'auction:update', {
    listings: listings.map(view),
    mine: listings.filter((l) => l.seller === player.name).map((l) => l.id),
    inventory: sellable(player),
    currencyItemId,
    currency: itemName(currencyItemId),
    feePercent,
  });
}
const pushAll = async () => {
  for (const player of getPlayers()) await push(player);
};

function failure(result, player, price) {
  const messages = {
    'unknown-item': 'No such item.',
    bound: 'That item cannot be sold.',
    'invalid-amount': 'The price has to be at least 1.',
    'not-enough': price
      ? t(player, 'You need {price} to buy that.', { price })
      : 'You do not have that many.',
    'no-space': 'Your bag is full.',
    missing: 'No such listing.',
    'not-yours': 'That listing is not yours.',
    'own-listing': 'You cannot buy your own listing.',
    'mailbox-full': 'Your mailbox has no room for it, so the listing stays up.',
    limit: t(player, 'You already have {count} listings.', {
      count: maxPerPlayer,
    }),
    'transactions-required': 'Auctions require MongoDB transactions.',
    busy: 'An inventory operation is still being saved. Try again.',
    'not-committed': 'The operation could not be saved. Try again.',
  };
  return messages[result.reason] || messages['not-committed'];
}

async function list(player, rawItemId, rawQuantity, rawPrice) {
  const itemId = Math.floor(num(rawItemId, 0));
  const quantity = Math.max(1, Math.floor(num(rawQuantity, 1)));
  const price = Math.floor(num(rawPrice, 0));
  const result = await auctions.create(player, {
    itemId,
    quantity,
    price,
    durationMs,
    maxListings: maxPerPlayer,
  });
  if (!result.ok) return failure(result, player);
  await pushAll();
  return t(player, 'Listed {quantity}x {item} for {price}.', {
    quantity,
    item: itemName(itemId),
    price,
  });
}

async function cancelListing(player, id) {
  const result = await auctions.cancel(String(id || ''), player.name);
  if (!result.ok) return failure(result, player);
  await pushAll();
  return 'Cancelled, and the item is in your mailbox.';
}

async function buy(player, id) {
  const listing = (await auctions.list()).find(
    (l) => l.id === String(id || ''),
  );
  if (!listing) return 'No such listing.';
  const result = await auctions.buy(
    player,
    listing.id,
    currencyItemId,
    feePercent,
  );
  if (!result.ok) return failure(result, player, listing.price);
  const seller = getPlayer(listing.seller);
  if (seller)
    sendMessage(
      seller,
      t(seller, '{buyer} bought your {quantity}x {item} for {price}.', {
        buyer: player.name,
        quantity: listing.quantity,
        item: itemName(listing.itemId),
        price: result.listing.payout,
      }),
    );
  await pushAll();
  return t(player, 'Bought {quantity}x {item} for {price}.', {
    quantity: listing.quantity,
    item: itemName(listing.itemId),
    price: listing.price,
  });
}

every(sweepTicks, async () => {
  await auctions.sweep();
  await pushAll();
});

on('customAction', async ({ player, channel, payload }) => {
  const data = /** @type {any} */ (payload);
  if (channel === 'auction:request') await push(player);
  else if (channel === 'auction:list')
    sendMessage(
      player,
      await list(player, data?.itemId, data?.quantity, data?.price),
    );
  else if (channel === 'auction:buy')
    sendMessage(player, await buy(player, data?.id));
  else if (channel === 'auction:cancel')
    sendMessage(player, await cancelListing(player, data?.id));
});

command(
  'auction',
  {
    description:
      'Auction: /auction list <itemId> <qty> <price> | cancel <id> | mine',
  },
  async ({ player, args, reply }) => {
    if (!player) return reply('Auction commands must be used in-game.');
    const sub = String(args[0] || '').toLowerCase();
    if (sub === 'list')
      return reply(await list(player, args[1], args[2], args[3]));
    if (sub === 'cancel') return reply(await cancelListing(player, args[1]));
    if (sub === 'buy') return reply(await buy(player, args[1]));
    if (sub === 'mine' || sub === '') {
      const listings = (await auctions.list()).filter(
        (l) => sub !== 'mine' || l.seller === player.name,
      );
      if (!listings.length)
        return reply(
          sub === 'mine'
            ? 'You have no listings.'
            : 'Nothing is up for auction.',
        );
      for (const listing of listings.slice(0, 20))
        reply(
          t(player, '#{id} {quantity}x {item} - {price} (by {seller})', {
            ...listing,
            item: itemName(listing.itemId),
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
  listings: async () => (await auctions.list()).map(view),
  list,
  buy,
  cancel: cancelListing,
  withdraw: async (id) => (await auctions.cancel(String(id))).ok,
});

// The old KV ledger cannot prove whether its debit or delivery was saved.
// Preserve it for reconciliation instead of guessing and minting a refund.
if (store.keys('auction').length)
  log(
    'Legacy auction entries require reconciliation; preserved in store scope auction.',
  );
log(
  `Auction module ready (currency=${currencyItemId}, ${durationMs / 3600_000}h, fee=${feePercent}%).`,
);
