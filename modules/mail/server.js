// @ts-check
// Mail module: send an item and a note to another player, online or not.
// The queue is core (`delivery`) so disabling the module cannot strand
// items; this holds the policy and the UI.

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

i18n({
  pt: {
    'That is not a valid quantity.': 'Essa quantidade não é válida.',
    'That item does not exist.': 'Esse item não existe.',
    'No player by that name.': 'Nenhum jogador com esse nome.',
    'That player has too much mail waiting.':
      'Esse jogador tem correio demais esperando.',
    'That note is too long.': 'Esse recado é longo demais.',
    'You do not have that item quantity.': 'Você não tem essa quantidade.',
    'Could not send that; nothing was taken. Try again.':
      'Não deu para enviar; nada foi retirado. Tente de novo.',
    'Could not send that.': 'Não deu para enviar.',
    'Usage: /mail send <player> <itemId> [qty] [message]':
      'Uso: /mail send <jogador> <idDoItem> [qtd] [recado]',
    'You cannot send mail to yourself.':
      'Você não pode enviar correio para si mesmo.',
    'That item is bound and cannot be mailed.':
      'Esse item é vinculado e não pode ser enviado.',
    'Postage costs {cost}.': 'A postagem custa {cost}.',
    'You have mail from {player}.': 'Você tem correio de {player}.',
    'Sent {quantity}x {item} to {player}.':
      'Enviado {quantity}x {item} para {player}.',
    'Nothing waiting for you.': 'Nada esperando por você.',
    'Your inventory is full.': 'Seu inventário está cheio.',
    'Collected {taken} item(s).': 'Recebido {taken} item(ns).',
    'Collected {taken} item(s). {left} left waiting.':
      'Recebido {taken} item(ns). {left} ainda esperando.',
    'Mail commands must be used in-game.':
      'Os comandos de correio só funcionam dentro do jogo.',
    'Your mailbox is empty.': 'Sua caixa de correio está vazia.',
    'Usage: /mail send <player> <itemId> [qty] [message] | /mail list | /mail claim':
      'Uso: /mail send <jogador> <idDoItem> [qtd] [recado] | /mail list | /mail claim',
    'You have {waiting} item(s) waiting in the mail. Open Mail to collect.':
      'Você tem {waiting} item(ns) esperando no correio. Abra o Correio para receber.',
  },
  es: {
    'That is not a valid quantity.': 'Esa cantidad no es válida.',
    'That item does not exist.': 'Ese objeto no existe.',
    'No player by that name.': 'No hay ningún jugador con ese nombre.',
    'That player has too much mail waiting.':
      'Ese jugador tiene demasiado correo esperando.',
    'That note is too long.': 'Esa nota es demasiado larga.',
    'You do not have that item quantity.': 'No tienes esa cantidad.',
    'Could not send that; nothing was taken. Try again.':
      'No se pudo enviar; no se quitó nada. Inténtalo de nuevo.',
    'Could not send that.': 'No se pudo enviar.',
    'Usage: /mail send <player> <itemId> [qty] [message]':
      'Uso: /mail send <jugador> <idDelObjeto> [cant] [nota]',
    'You cannot send mail to yourself.':
      'No puedes enviarte correo a ti mismo.',
    'That item is bound and cannot be mailed.':
      'Ese objeto está vinculado y no se puede enviar.',
    'Postage costs {cost}.': 'El envío cuesta {cost}.',
    'You have mail from {player}.': 'Tienes correo de {player}.',
    'Sent {quantity}x {item} to {player}.':
      'Enviado {quantity}x {item} a {player}.',
    'Nothing waiting for you.': 'No hay nada esperándote.',
    'Your inventory is full.': 'Tu inventario está lleno.',
    'Collected {taken} item(s).': 'Recibiste {taken} objeto(s).',
    'Collected {taken} item(s). {left} left waiting.':
      'Recibiste {taken} objeto(s). Quedan {left} esperando.',
    'Mail commands must be used in-game.':
      'Los comandos de correo solo funcionan dentro del juego.',
    'Your mailbox is empty.': 'Tu buzón está vacío.',
    'Usage: /mail send <player> <itemId> [qty] [message] | /mail list | /mail claim':
      'Uso: /mail send <jugador> <idDelObjeto> [cant] [nota] | /mail list | /mail claim',
    'You have {waiting} item(s) waiting in the mail. Open Mail to collect.':
      'Tienes {waiting} objeto(s) esperando en el correo. Abre el Correo para recibirlos.',
  },
});

const FAILURE_TEXT = {
  'invalid-amount': 'That is not a valid quantity.',
  'unknown-item': 'That item does not exist.',
  'unknown-recipient': 'No player by that name.',
  'mailbox-full': 'That player has too much mail waiting.',
  'meta-too-large': 'That note is too long.',
  'not-enough': 'You do not have that item quantity.',
  'not-committed': 'Could not send that; nothing was taken. Try again.',
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
      sprite: item ? item.sprite : 0,
      quantity: row.quantity,
      from: String(meta.from || 'someone'),
      message: String(meta.message || ''),
      sentAt: row.createdAt,
    };
  });
}

// Sends the queue with the letter limits and postage, so the form can show
// them. Never rejects, since it is fired unawaited from other replies.
async function push(player) {
  let letters;
  try {
    letters = await inbox(player.name);
  } catch (e) {
    error('mail inbox read failed: ' + e);
    return;
  }
  sendEvent(player, 'mail:update', {
    letters,
    maxMessageLength,
    postage:
      costPerLetter > 0
        ? {
            cost: costPerLetter,
            item: getItem(currencyItemId)?.name ?? `#${currencyItemId}`,
          }
        : undefined,
  });
}

// A chat command is answered in the chat; what the window asked for is
// answered to the window.
const answer = (player) => (text) =>
  sendEvent(player, 'mail:result', { message: t(player, text) });

/**
 * Hands the item and the postage to the engine, which debits both and queues
 * the letter as one commit, and leaves the inventory untouched when it fails.
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

  if (costPerLetter > 0 && !hasItem(player, currencyItemId, costPerLetter)) {
    return t(player, 'Postage costs {cost}.', { cost: costPerLetter });
  }

  const queued = await delivery.send(player, {
    to,
    itemId,
    quantity,
    meta: { from: player.name, message: note },
    ...(costPerLetter > 0 && {
      fee: { itemId: currencyItemId, quantity: costPerLetter },
    }),
  });

  if (queued.ok) {
    const recipient = getPlayer(to);
    if (recipient) {
      sendMessage(
        recipient,
        t(recipient, 'You have mail from {player}.', { player: player.name }),
      );
      void push(recipient);
    }
    return t(player, 'Sent {quantity}x {item} to {player}.', {
      quantity,
      item: info.name,
      player: to,
    });
  }

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
  return left > 0
    ? t(player, 'Collected {taken} item(s). {left} left waiting.', {
        taken,
        left,
      })
    : t(player, 'Collected {taken} item(s).', { taken });
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
      return send(player, args[1], args[2], args[3], message).then(reply);
    }

    if (sub === 'claim') {
      return claim(player).then(reply);
    }

    if (sub === 'list') {
      return inbox(player.name).then((letters) => {
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
    }

    reply(
      'Usage: /mail send <player> <itemId> [qty] [message] | /mail list | /mail claim',
    );
  },
);

// The promises go back to the hook and command wrappers, which log a
// rejection they are handed; one dropped here would end the process.
on('customAction', ({ player, channel, payload }) => {
  const data = /** @type {any} */ (payload) || {};
  if (channel === 'mail:request') return push(player);
  if (channel === 'mail:claim') {
    const ids = Array.isArray(data.ids) ? data.ids.map(String) : undefined;
    return claim(player, ids).then(answer(player));
  }
  if (channel === 'mail:send') {
    return send(player, data.to, data.itemId, data.quantity, data.message).then(
      answer(player),
    );
  }
});

// Tells the player about waiting mail on arrival, since a full bag could
// leave it queued unseen.
on('playerJoin', ({ player }) =>
  delivery.count(player.name).then((waiting) => {
    if (waiting > 0) {
      sendMessage(
        player,
        t(
          player,
          'You have {waiting} item(s) waiting in the mail. Open Mail to collect.',
          { waiting },
        ),
      );
    }
  }),
);

provide('mail', {
  send,
  claim,
  inbox,
});

log(
  `Mail module ready (maxMessageLength=${maxMessageLength}, cost=${costPerLetter}).`,
);
