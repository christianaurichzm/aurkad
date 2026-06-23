// Bank module: per-player item storage in the shared KV store. Moves are
// validated before the core give and remove helpers run.

const maxSlots = Math.max(1, Math.floor(Number((config && config.maxSlots) || 50)));

function positiveInt(value, fallback) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function emptyBank() {
  return { maxCapacity: maxSlots, items: [] };
}

function getBank(player) {
  const bank = store.get('bank', player.name);
  if (!bank || !Array.isArray(bank.items)) return emptyBank();
  return { maxCapacity: bank.maxCapacity || maxSlots, items: bank.items.slice() };
}

function saveBank(player, bank) {
  const normalized = {
    maxCapacity: bank.maxCapacity || maxSlots,
    items: bank.items.filter((entry) => entry.quantity > 0),
  };
  store.set('bank', player.name, normalized);
  sendEvent(player, 'bank:update', normalized);
  return normalized;
}

function quantity(items, itemId) {
  const slot = items.find((entry) => Number(entry.item) === Number(itemId));
  return slot ? slot.quantity : 0;
}

function hasInventory(player, itemId, amount) {
  return quantity(player.inventory.items, itemId) >= amount;
}

function canAdd(items, maxCapacity, itemId) {
  if (quantity(items, itemId) > 0) return true;
  return items.filter((entry) => entry.quantity > 0).length < maxCapacity;
}

function add(items, itemId, amount) {
  const slot = items.find((entry) => Number(entry.item) === Number(itemId));
  if (slot) slot.quantity += amount;
  else items.push({ item: itemId, quantity: amount });
}

function remove(items, itemId, amount) {
  const slot = items.find((entry) => Number(entry.item) === Number(itemId));
  if (!slot || slot.quantity < amount) return false;
  slot.quantity -= amount;
  return true;
}

function deposit(player, itemIdValue, amountValue) {
  const itemId = positiveInt(itemIdValue, 0);
  const amount = positiveInt(amountValue, 1);
  if (!itemId || !hasInventory(player, itemId, amount)) return 'You do not have that item quantity.';

  const bank = getBank(player);
  if (!canAdd(bank.items, bank.maxCapacity, itemId)) return 'Your bank is full.';

  removeItem(player, itemId, amount);
  add(bank.items, itemId, amount);
  saveBank(player, bank);
  return 'Deposited.';
}

function withdraw(player, itemIdValue, amountValue) {
  const itemId = positiveInt(itemIdValue, 0);
  const amount = positiveInt(amountValue, 1);
  const bank = getBank(player);
  if (!itemId || quantity(bank.items, itemId) < amount) return 'That item is not in your bank.';
  if (!canAdd(player.inventory.items, player.inventory.maxCapacity, itemId)) return 'Your inventory is full.';

  remove(bank.items, itemId, amount);
  giveItem(player, itemId, amount);
  saveBank(player, bank);
  return 'Withdrew.';
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
      const summary = bank.items.map((entry) => `${entry.item}x${entry.quantity}`).join(', ') || 'empty';
      return reply(`Bank: ${summary}`);
    }
    reply('Usage: /bank deposit|withdraw <item> [qty] or /bank list');
  },
);

on('customAction', ({ player, channel, payload }) => {
  if (channel === 'bank:deposit') deposit(player, payload && payload.itemId, payload && payload.quantity);
  else if (channel === 'bank:withdraw') withdraw(player, payload && payload.itemId, payload && payload.quantity);
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
