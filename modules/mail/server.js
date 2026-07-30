// @ts-check
// Mail module: send an item and a note to another player, online or not.
// The queue is core (`delivery`), since items owed to someone are an item
// conservation problem `game.json` must not switch off; this module holds
// the policy: who may send, what a letter costs, the note's length, the UI.
//
// Claims are exactly-once (see deliveryService). The send cannot be atomic
// on a single MongoDB: the sender is debited and persisted before the row
// is queued, so a crash in between loses the item rather than duplicating
// it. A duplicate is invisible inflation and a loss one visible ticket;
// closing the gap needs a replica set.

const maxMessageLength = Math.max(
  0,
  Math.floor(Number((config && config.maxMessageLength) ?? 140)),
);
const costPerLetter = Math.max(
  0,
  Math.floor(Number((config && config.costPerLetter) ?? 0)),
);
const currencyItemId = Math.max(
  1,
  Math.floor(Number((config && config.currencyItemId) ?? 3)),
);

function positiveInt(value, fallback) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const FAILURE_TEXT = {
  'invalid-amount': 'That is not a valid quantity.',
  'unknown-item': 'That item does not exist.',
  'unknown-recipient': 'No player by that name.',
  'mailbox-full': 'That player has too much mail waiting.',
  'meta-too-large': 'That note is too long.',
};

/** Rows the recipient can read, with item names resolved for display. */
async function inbox(name) {
  const rows = await delivery.list(name);
  return rows.map((row) => {
    const item = getItem(row.itemId);
    const meta = /** @type {any} */ (row.meta) || {};
    return {
      id: row.id,
      itemId: row.itemId,
      itemName: item ? item.name : `#${row.itemId}`,
      quantity: row.quantity,
      from: String(meta.from || 'someone'),
      message: String(meta.message || ''),
      sentAt: row.createdAt,
    };
  });
}

async function push(player) {
  sendEvent(player, 'mail:update', { letters: await inbox(player.name) });
}

/**
 * Takes the item from the sender, then queues it.
 *
 * The refund path matters: a rejected queue (bad name, recipient's mailbox
 * full) must not cost the sender the item, and re-adding always fits because
 * the slot it came from was freed a moment earlier.
 */
async function send(player, toName, itemIdValue, quantityValue, message) {
  const to = String(toName || '').trim();
  if (!to) return 'Usage: /mail send <player> <itemId> [qty] [message]';
  if (to.toLowerCase() === player.name.toLowerCase()) {
    return 'You cannot send mail to yourself.';
  }

  const itemId = positiveInt(itemIdValue, 0);
  const quantity = positiveInt(quantityValue, 1);
  if (!itemId) return 'Usage: /mail send <player> <itemId> [qty] [message]';

  const info = getItem(itemId);
  if (!info) return 'That item does not exist.';
  if (info.bound) return 'That item is bound and cannot be mailed.';
  if (!hasItem(player, itemId, quantity)) {
    return 'You do not have that item quantity.';
  }

  const note = String(message || '').slice(0, maxMessageLength);

  if (costPerLetter > 0) {
    if (!hasItem(player, currencyItemId, costPerLetter)) {
      return `Postage costs ${costPerLetter}.`;
    }
    if (!removeItem(player, currencyItemId, costPerLetter)) {
      return `Postage costs ${costPerLetter}.`;
    }
  }

  if (!removeItem(player, itemId, quantity)) {
    if (costPerLetter > 0) giveItem(player, currencyItemId, costPerLetter);
    return 'You do not have that item quantity.';
  }
  // Commit the debit before the row exists: the reverse order would leave a
  // claimable copy in the queue while the sender still holds the original.
  persistNow(player);

  const queued = await delivery.queue({
    to,
    itemId,
    quantity,
    meta: { from: player.name, message: note },
  });

  if (queued.ok) {
    const recipient = getPlayer(to);
    if (recipient) {
      sendMessage(recipient, `You have mail from ${player.name}.`);
      void push(recipient);
    }
    return `Sent ${quantity}x ${info.name} to ${to}.`;
  }

  giveItem(player, itemId, quantity);
  if (costPerLetter > 0) giveItem(player, currencyItemId, costPerLetter);
  persistNow(player);
  return FAILURE_TEXT[queued.reason] || 'Could not send that.';
}

async function claim(player, ids) {
  const outcomes = await delivery.claim(player, ids);
  if (outcomes.length === 0) return 'Nothing waiting for you.';

  const taken = outcomes.filter((o) => o.ok).length;
  // Whatever did not come through stays queued - almost always a full bag.
  const left = outcomes.length - taken;

  void push(player);

  if (taken === 0) return 'Your inventory is full.';
  return `Collected ${taken} item(s).${left > 0 ? ` ${left} left waiting.` : ''}`;
}

command(
  'mail',
  {
    description:
      'Mail: /mail send <player> <itemId> [qty] [message] | /mail list | /mail claim',
  },
  ({ player, args, reply }) => {
    if (!player) return reply('Mail commands must be used in-game.');
    const sub = String(args[0] || '').toLowerCase();

    if (sub === 'send') {
      const message = args.slice(4).join(' ');
      void send(player, args[1], args[2], args[3], message).then(reply);
      return;
    }

    if (sub === 'claim') {
      void claim(player).then(reply);
      return;
    }

    if (sub === 'list') {
      void inbox(player.name).then((letters) => {
        if (letters.length === 0) return reply('Your mailbox is empty.');
        reply(
          letters
            .map(
              (l) =>
                `${l.from}: ${l.quantity}x ${l.itemName}` +
                (l.message ? ` - "${l.message}"` : ''),
            )
            .join('\n'),
        );
      });
      return;
    }

    reply(
      'Usage: /mail send <player> <itemId> [qty] [message] | /mail list | /mail claim',
    );
  },
);

on('customAction', ({ player, channel, payload }) => {
  const data = /** @type {any} */ (payload) || {};
  if (channel === 'mail:request') void push(player);
  else if (channel === 'mail:claim') {
    const ids = Array.isArray(data.ids) ? data.ids.map(String) : undefined;
    void claim(player, ids).then((text) => sendMessage(player, text));
  } else if (channel === 'mail:send') {
    void send(player, data.to, data.itemId, data.quantity, data.message).then(
      (text) => sendMessage(player, text),
    );
  }
});

// Tells the player about waiting mail on arrival, since a full bag could
// leave it queued unseen.
on('playerJoin', ({ player }) => {
  void delivery.count(player.name).then((waiting) => {
    if (waiting > 0) {
      sendMessage(
        player,
        `You have ${waiting} item(s) waiting in the mail. Open Mail to collect.`,
      );
    }
  });
});

provide('mail', {
  send,
  claim,
  inbox,
});

log(
  `Mail module ready (maxMessageLength=${maxMessageLength}, cost=${costPerLetter}).`,
);
