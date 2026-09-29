// @ts-check
// Trade module, client entry. The Trade button (T) opens a panel with
// incoming offers to accept and a form for a new offer. Clicking another
// player on the canvas fills in the player name.

// Strings this module draws, keyed by the English itself: text handed to the
// `ui` helpers is translated for free, the rest goes through engine.t.
engine.i18n({
  pt: {
    Trade: 'Troca',
    'Player name': 'Nome do jogador',
    'Give item ID': 'ID do item ofertado',
    Qty: 'Qtd',
    'Want item ID (opt)': 'ID do item desejado (opc)',
    'Send Offer': 'Enviar oferta',
    Accept: 'Aceitar',
    Cancel: 'Cancelar',
    'Incoming offers': 'Ofertas recebidas',
    'Your offers': 'Suas ofertas',
    'No active trades.': 'Nenhuma troca ativa.',
    'Send offer': 'Enviar oferta',
    '{give} for {want}': '{give} por {want}',
    '{give} (gift)': '{give} (presente)',
    'Trade with {player} completed.': 'Troca com {player} concluída.',
    'Trade complete with {player}!': 'Troca concluída com {player}!',
  },
});

const ui = engine.ui;
const panel = ui.panel({ title: 'Trade' });
ui.actionButton(
  'Trade',
  () => {
    panel.toggle();
    if (panel.isOpen()) {
      engine.sendServerEvent('trade:request');
      window.dispatchEvent(new CustomEvent('trade:active'));
    } else {
      window.dispatchEvent(new CustomEvent('trade:inactive'));
    }
  },
  't',
);

window.addEventListener('inventory:item-for-trade', function (e) {
  const detail = /** @type {CustomEvent} */ (e).detail;
  giveItem.value = String(detail.itemId);
  giveQty.value = '1';
});

let myName = null;
let offers = [];

// Persistent form inputs (not recreated on each render)
const toInput = ui.input('Player name');
const giveItem = ui.input('Give item ID');
giveItem.type = 'number';
giveItem.style.width = '80px';
const giveQty = ui.input('Qty');
giveQty.type = 'number';
giveQty.value = '1';
giveQty.style.width = '50px';
const wantItem = ui.input('Want item ID (opt)');
wantItem.type = 'number';
wantItem.style.width = '80px';
const wantQty = ui.input('Qty');
wantQty.type = 'number';
wantQty.value = '1';
wantQty.style.width = '50px';

const sendBtn = ui.button('Send Offer', () => {
  const payload = {
    to: toInput.value.trim(),
    giveItemId: Number(giveItem.value),
    giveQty: Number(giveQty.value) || 1,
    wantItemId: wantItem.value ? Number(wantItem.value) : undefined,
    wantQty: wantItem.value ? Number(wantQty.value) || 1 : undefined,
  };
  if (payload.to && payload.giveItemId > 0)
    engine.sendServerEvent('trade:offer', payload);
});

function offerLabel(offer) {
  const giveName = offer.give.name || `#${offer.give.itemId}`;
  const give = `${giveName}×${offer.give.quantity}`;
  if (!offer.want) return engine.t('{give} (gift)', { give });
  const wantName = offer.want.name || `#${offer.want.itemId}`;
  return engine.t('{give} for {want}', {
    give,
    want: `${wantName}×${offer.want.quantity}`,
  });
}

function render() {
  const incoming = offers.filter((o) => o.to === myName);
  const outgoing = offers.filter((o) => o.from === myName);
  const sections = [];

  if (incoming.length) {
    const title = document.createElement('div');
    title.textContent = engine.t('Incoming offers');
    title.style.cssText = 'font-weight:bold;font-size:12px;margin-bottom:4px;';
    sections.push(title);

    for (const offer of incoming) {
      const row = document.createElement('div');
      row.style.cssText =
        'display:flex;justify-content:space-between;align-items:center;' +
        'padding:3px 0;border-bottom:1px solid var(--color-surface-muted);font-size:12px;';
      const label = document.createElement('span');
      label.textContent = `${offer.from}: ${offerLabel(offer)}`;
      const acceptBtn = ui.button('Accept', () =>
        engine.sendServerEvent('trade:accept', { from: offer.from }),
      );
      acceptBtn.style.cssText += 'font-size:11px;padding:3px 7px;';
      const cancelBtn = ui.button('✕', () =>
        engine.sendServerEvent('trade:cancel', { player: offer.from }),
      );
      cancelBtn.style.cssText += 'font-size:11px;padding:3px 7px;';
      row.append(label, ui.row(acceptBtn, cancelBtn));
      sections.push(row);
    }
  }

  if (outgoing.length) {
    const title = document.createElement('div');
    title.textContent = engine.t('Your offers');
    title.style.cssText =
      'font-weight:bold;font-size:12px;margin-top:8px;margin-bottom:4px;';
    sections.push(title);

    for (const offer of outgoing) {
      const row = document.createElement('div');
      row.style.cssText =
        'display:flex;justify-content:space-between;align-items:center;' +
        'padding:3px 0;border-bottom:1px solid var(--color-surface-muted);font-size:12px;';
      const label = document.createElement('span');
      label.textContent = `→ ${offer.to}: ${offerLabel(offer)}`;
      const cancelBtn = ui.button('Cancel', () =>
        engine.sendServerEvent('trade:cancel', { player: offer.to }),
      );
      cancelBtn.style.cssText += 'font-size:11px;padding:3px 7px;';
      row.append(label, cancelBtn);
      sections.push(row);
    }
  }

  if (!incoming.length && !outgoing.length) {
    const empty = document.createElement('div');
    empty.textContent = engine.t('No active trades.');
    empty.style.cssText =
      'color:var(--color-text-muted);font-size:12px;padding:4px 0;';
    sections.push(empty);
  }

  const sep = document.createElement('div');
  sep.style.cssText =
    'border-top:1px solid var(--color-border);padding-top:8px;margin-top:8px;';
  const formLabel = document.createElement('div');
  formLabel.textContent = engine.t('Send offer');
  formLabel.style.cssText =
    'font-weight:bold;font-size:12px;margin-bottom:4px;';
  sep.append(
    formLabel,
    toInput,
    ui.row(giveItem, giveQty),
    ui.row(wantItem, wantQty),
    sendBtn,
  );
  sections.push(sep);

  panel.setBody(...sections);
}

engine.onServerEvent('trade:update', (data) => {
  if (!data || !Array.isArray(data.offers)) return;
  myName = data.player;
  offers = data.offers;
  render();
});

engine.onServerEvent('trade:complete', (offer) => {
  const other = offer.from === myName ? offer.to : offer.from;
  engine.chat(engine.t('Trade with {player} completed.', { player: other }));
  const msg = document.createElement('div');
  msg.textContent = engine.t('Trade complete with {player}!', {
    player: other,
  });
  msg.style.cssText =
    'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
    'background:var(--color-primary);color:#fff;padding:8px 16px;border-radius:6px;' +
    'font:bold 13px sans-serif;z-index:9999;pointer-events:none;';
  document.body.appendChild(msg);
  setTimeout(() => msg.remove(), 3000);
  engine.sendServerEvent('trade:request');
});

engine.registerPlayerAction('Trade', (name) => {
  toInput.value = name;
  panel.show();
  engine.sendServerEvent('trade:request');
  window.dispatchEvent(new CustomEvent('trade:active'));
});

engine.sendServerEvent('trade:request');
render();
