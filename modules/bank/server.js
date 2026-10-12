// @ts-check
// Bank module: item storage in player.data.bank, the same document as the
// inventory, so one write covers both sides of a move.

// Translations keyed by the English text. reply and sendMessage translate
// on their own; a sentence carrying a value goes through t().
i18n({
  pt: {
    'You do not have that item quantity.': 'Você não tem essa quantidade.',
    'That item is bound and cannot be banked.':
      'Esse item é vinculado e não pode ir para o banco.',
    'Deposited.': 'Depositado.',
    'Your bank is full.': 'Seu banco está cheio.',
    'That item is not in your bank.': 'Esse item não está no seu banco.',
    'Withdrew.': 'Sacado.',
    'The bank cannot be saved.': 'Não foi possível salvar o banco.',
    'Your inventory is full.': 'Seu inventário está cheio.',
    'Bank commands must be used in-game.':
      'Os comandos de banco só funcionam dentro do jogo.',
    'Bank: {summary}': 'Banco: {summary}',
    empty: 'vazio',
    'Usage: /bank deposit|withdraw <item> [qty] or /bank list':
      'Uso: /bank deposit|withdraw <item> [qtd] ou /bank list',
  },
});

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

  return emptyBank();
}

/**
 * The bank as the window draws it: each stack with its item, the shape a bag
 * entry has on the client, so one slot draws both sides.
 */
function view(bank) {
  return {
    maxCapacity: bank.maxCapacity,
    items: bank.items.map((entry) => ({
      // A stack whose item left the content still takes a slot and must show
      // so it can be taken out.
      item: getItem(entry.item) || {
        id: entry.item,
        name: '#' + entry.item,
        sprite: 0,
        type: 'consumable',
        effects: [],
      },
      quantity: entry.quantity,
    })),
  };
}

function saveBank(player, bank) {
  const normalized = {
    maxCapacity: bank.maxCapacity || maxSlots,
    items: bank.items.filter((entry) => entry.quantity > 0),
  };
  if (!setPlayerData(player, 'bank', normalized)) return false;
  persistNow(player);
  sendEvent(player, 'bank:update', view(normalized));
  return true;
}

// Both directions go through moveItem. The bag is put back when the bank
// cannot be stored, or the deposit would be lost or the withdrawal doubled.
function transfer(player, toBank, itemId, amount) {
  const bank = getBank(player);
  const bag = player.inventory.items.map((entry) => ({ ...entry }));
  const moved = toBank
    ? moveItem(player.inventory, bank, itemId, amount)
    : moveItem(bank, player.inventory, itemId, amount);
  if (!moved.ok || saveBank(player, bank)) return moved;
  player.inventory.items = bag;
  return { ok: false, reason: 'not-stored' };
}

function deposit(player, itemIdValue, amountValue) {
  const itemId = positiveInt(itemIdValue, 0);
  const amount = positiveInt(amountValue, 1);
  if (!itemId) return 'You do not have that item quantity.';

  const info = getItem(itemId);
  if (info && info.bound) return 'That item is bound and cannot be banked.';

  const moved = transfer(player, true, itemId, amount);
  if (moved.ok) return 'Deposited.';
  if (moved.reason === 'not-stored') return 'The bank cannot be saved.';
  return moved.reason === 'no-space'
    ? 'Your bank is full.'
    : 'You do not have that item quantity.';
}

function withdraw(player, itemIdValue, amountValue) {
  const itemId = positiveInt(itemIdValue, 0);
  const amount = positiveInt(amountValue, 1);
  if (!itemId) return 'That item is not in your bank.';

  const moved = transfer(player, false, itemId, amount);
  if (moved.ok) return 'Withdrew.';
  if (moved.reason === 'not-stored') return 'The bank cannot be saved.';
  return moved.reason === 'no-space'
    ? 'Your inventory is full.'
    : 'That item is not in your bank.';
}

function push(player) {
  sendEvent(player, 'bank:update', view(getBank(player)));
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
          .join(', ') || t(player, 'empty');
      return reply(t(player, 'Bank: {summary}', { summary }));
    }
    reply('Usage: /bank deposit|withdraw <item> [qty] or /bank list');
  },
);

on('customAction', ({ player, channel, payload }) => {
  const data = /** @type {any} */ (payload);
  let said;
  if (channel === 'bank:deposit')
    said = deposit(player, data && data.itemId, data && data.quantity);
  else if (channel === 'bank:withdraw')
    said = withdraw(player, data && data.itemId, data && data.quantity);
  else if (channel === 'bank:request') push(player);
  // The answer goes to the window, beside the slot that was clicked.
  if (said) sendEvent(player, 'bank:result', { message: t(player, said) });
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
