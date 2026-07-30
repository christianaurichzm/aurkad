// @ts-check
// Bank module: item storage in player.data.bank, the same document as the
// inventory, so one write covers both sides of a move. A bank still in the
// shared KV store is moved over on first access.

const maxSlots = Math.max(
  1,
  Math.floor(Number((config && config.maxSlots) || 50)),
);

function positiveInt(value, fallback) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** @typedef {{ maxCapacity: number, items: { item: number, quantity: number }[] }} Bank */

/** @returns {Bank} */
function emptyBank() {
  return { maxCapacity: maxSlots, items: [] };
}

/** @returns {Bank} */
function getBank(player) {
  const bank = /** @type {Bank|undefined} */ (getPlayerData(player, 'bank'));
  if (bank && Array.isArray(bank.items)) {
    return {
      maxCapacity: bank.maxCapacity || maxSlots,
      items: bank.items.slice(),
    };
  }

  // One-time migration from the legacy KV location. Persist the player before
  // deleting the KV copy so the bank is never only in the deleted store.
  const legacy = /** @type {Bank|undefined} */ (store.get('bank', player.name));
  if (legacy && Array.isArray(legacy.items)) {
    const migrated = {
      maxCapacity: legacy.maxCapacity || maxSlots,
      items: legacy.items.slice(),
    };
    setPlayerData(player, 'bank', migrated);
    persistNow(player);
    store.delete('bank', player.name);
    return { maxCapacity: migrated.maxCapacity, items: migrated.items.slice() };
  }

  return emptyBank();
}

function saveBank(player, bank) {
  const normalized = {
    maxCapacity: bank.maxCapacity || maxSlots,
    items: bank.items.filter((entry) => entry.quantity > 0),
  };
  setPlayerData(player, 'bank', normalized);
  persistNow(player);
  sendEvent(player, 'bank:update', normalized);
  return normalized;
}

// Both directions go through moveItem, which checks source and destination
// before touching either.
function deposit(player, itemIdValue, amountValue) {
  const itemId = positiveInt(itemIdValue, 0);
  const amount = positiveInt(amountValue, 1);
  if (!itemId) return 'You do not have that item quantity.';

  const info = getItem(itemId);
  if (info && info.bound) return 'That item is bound and cannot be banked.';

  const bank = getBank(player);
  const moved = moveItem(player.inventory, bank, itemId, amount);
  if (moved.ok) {
    saveBank(player, bank);
    return 'Deposited.';
  }
  return moved.reason === 'no-space'
    ? 'Your bank is full.'
    : 'You do not have that item quantity.';
}

function withdraw(player, itemIdValue, amountValue) {
  const itemId = positiveInt(itemIdValue, 0);
  const amount = positiveInt(amountValue, 1);
  if (!itemId) return 'That item is not in your bank.';

  const bank = getBank(player);
  const moved = moveItem(bank, player.inventory, itemId, amount);
  if (moved.ok) {
    saveBank(player, bank);
    return 'Withdrew.';
  }
  return moved.reason === 'no-space'
    ? 'Your inventory is full.'
    : 'That item is not in your bank.';
}

function push(player) {
  sendEvent(player, 'bank:update', getBank(player));
}

command(
  'bank',
  { description: 'Bank: /bank deposit|withdraw <item> [qty] or /bank list' },
  ({ player, args, reply }) => {
    if (!player) return reply('Bank commands must be used in-game.');
    const sub = String(args[0] || '').toLowerCase();
    if (sub === 'deposit') return reply(deposit(player, args[1], args[2]));
    if (sub === 'withdraw') return reply(withdraw(player, args[1], args[2]));
    if (sub === 'list') {
      const bank = getBank(player);
      const summary =
        bank.items
          .map((entry) => `${entry.item}x${entry.quantity}`)
          .join(', ') || 'empty';
      return reply(`Bank: ${summary}`);
    }
    reply('Usage: /bank deposit|withdraw <item> [qty] or /bank list');
  },
);

on('customAction', ({ player, channel, payload }) => {
  const data = /** @type {any} */ (payload);
  if (channel === 'bank:deposit')
    deposit(player, data && data.itemId, data && data.quantity);
  else if (channel === 'bank:withdraw')
    withdraw(player, data && data.itemId, data && data.quantity);
  else if (channel === 'bank:request') push(player);
});

on('tileEnter', ({ player, tile }) => {
  if (tile.bank) {
    push(player);
    sendEvent(player, 'bank:open');
  }
});

provide('bank', {
  get: getBank,
  deposit,
  withdraw,
});

log(`Bank module ready (maxSlots=${maxSlots}).`);
