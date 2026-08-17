// @ts-check
// Mail module, client entry: a panel (M) with waiting letters to collect
// and a form to send an item to another player. The server decides whether
// a send or a claim goes through.

// Strings this module draws, keyed by the English itself: text handed to the
// `ui` helpers is translated for free, the rest goes through engine.t.
engine.i18n({
  pt: {
    Mail: 'Correio',
    'From {player}': 'De {player}',
    Collect: 'Receber',
    'Collect all': 'Receber tudo',
    'Nothing waiting.': 'Nada esperando.',
    'To (player)': 'Para (jogador)',
    'Item ID': 'ID do item',
    Qty: 'Qtd',
    'Note (optional)': 'Recado (opcional)',
    Send: 'Enviar',
    'Send an item': 'Enviar um item',
  },
});

const ui = engine.ui;
const panel = ui.panel({ title: 'Mail' });
ui.actionButton(
  'Mail',
  () => {
    panel.toggle();
    if (panel.isOpen()) engine.sendServerEvent('mail:request');
  },
  'm',
);

let letters = []; // [{ id, itemId, itemName, quantity, from, message, sentAt }]

function letterCard(letter) {
  const card = document.createElement('div');
  card.style.cssText =
    'padding:6px 8px;border-radius:4px;border:1px solid #333;background:#1a1a1a;margin-bottom:4px;';

  const header = document.createElement('div');
  header.style.cssText =
    'display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13px;';

  const who = document.createElement('span');
  who.textContent = engine.t('From {player}', { player: letter.from });
  who.style.cssText = 'font-weight:bold;color:#eee;';

  const collect = ui.button('Collect', () => {
    engine.sendServerEvent('mail:claim', { ids: [letter.id] });
  });
  collect.style.cssText += 'font-size:11px;padding:3px 7px;';

  header.append(who, collect);

  const contents = document.createElement('div');
  contents.textContent = `${letter.quantity}× ${letter.itemName}`;
  contents.style.cssText = 'font-size:12px;color:#f59e0b;margin-top:2px;';

  card.append(header, contents);

  if (letter.message) {
    const note = document.createElement('div');
    note.textContent = letter.message;
    note.style.cssText =
      'font-size:12px;color:#aaa;margin-top:3px;font-style:italic;';
    card.appendChild(note);
  }

  return card;
}

function sendForm() {
  const toInput = ui.input('To (player)');
  const itemInput = ui.input('Item ID');
  itemInput.type = 'number';
  itemInput.min = '1';
  itemInput.style.width = '80px';
  const qtyInput = ui.input('Qty');
  qtyInput.type = 'number';
  qtyInput.min = '1';
  qtyInput.value = '1';
  qtyInput.style.width = '60px';
  const messageInput = ui.input('Note (optional)');

  const sendBtn = ui.button('Send', () => {
    const to = toInput.value.trim();
    const itemId = Number(itemInput.value);
    if (!to || !(itemId > 0)) return;
    engine.sendServerEvent('mail:send', {
      to,
      itemId,
      quantity: Number(qtyInput.value) || 1,
      message: messageInput.value,
    });
    itemInput.value = '';
    messageInput.value = '';
  });

  const label = document.createElement('div');
  label.textContent = engine.t('Send an item');
  label.style.cssText = 'font-size:11px;color:#aaa;margin-bottom:4px;';

  const wrap = document.createElement('div');
  wrap.style.cssText = 'border-top:1px solid #333;padding-top:8px;';
  wrap.append(
    label,
    ui.row(toInput, itemInput, qtyInput),
    ui.row(messageInput, sendBtn),
  );
  return wrap;
}

function render() {
  const list = document.createElement('div');
  list.style.cssText = 'max-height:200px;overflow-y:auto;margin-bottom:8px;';

  if (letters.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = engine.t('Nothing waiting.');
    empty.style.cssText = 'color:#888;font-size:12px;padding:4px 0;';
    list.appendChild(empty);
  } else {
    for (const letter of letters) list.appendChild(letterCard(letter));
  }

  const collectAll = ui.button('Collect all', () => {
    engine.sendServerEvent('mail:claim', {});
  });
  collectAll.style.cssText += 'font-size:11px;padding:3px 7px;';

  panel.setBody(list, collectAll, sendForm());
}

engine.onServerEvent('mail:update', (data) => {
  const payload = /** @type {any} */ (data);
  letters = payload && Array.isArray(payload.letters) ? payload.letters : [];
  render();
});

render();
