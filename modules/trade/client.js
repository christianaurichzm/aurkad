// Trade module, client entry. The Trade button (T) opens a panel with
// incoming offers to accept and a form for a new offer. Clicking another
// player on the canvas fills in the player name.

const ui = engine.ui;
const panel = ui.panel({ title: 'Trade' });
ui.actionButton('Trade', () => {
  panel.toggle();
  if (panel.isOpen()) {
    engine.sendServerEvent('trade:request');
    window.dispatchEvent(new CustomEvent('trade:active'));
  } else {
    window.dispatchEvent(new CustomEvent('trade:inactive'));
  }
}, 't');

window.addEventListener('inventory:item-for-trade', function (e) {
  giveItem.value = String(e.detail.itemId);
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
  const give = `#${offer.give.itemId}×${offer.give.quantity}`;
  const want = offer.want ? ` for #${offer.want.itemId}×${offer.want.quantity}` : ' (gift)';
  return `${give}${want}`;
}

function render() {
  const incoming = offers.filter((o) => o.to === myName);
  const outgoing = offers.filter((o) => o.from === myName);
  const sections = [];

  if (incoming.length) {
    const title = document.createElement('div');
    title.textContent = 'Incoming offers';
    title.style.cssText = 'font-weight:bold;font-size:12px;margin-bottom:4px;';
    sections.push(title);

    for (const offer of incoming) {
      const row = document.createElement('div');
      row.style.cssText =
        'display:flex;justify-content:space-between;align-items:center;' +
        'padding:3px 0;border-bottom:1px solid #2a2a2a;font-size:12px;';
      const label = document.createElement('span');
      label.textContent = `${offer.from}: ${offerLabel(offer)}`;
      const acceptBtn = ui.button('Accept', () =>
        engine.sendServerEvent('trade:accept', { from: offer.from }),
      );
      acceptBtn.style.cssText += 'font-size:11px;padding:3px 7px;';
      const cancelBtn = ui.button('✕', () =>
        engine.sendServerEvent('trade:cancel', { player: offer.from }),
      );
      cancelBtn.style.cssText += 'font-size:11px;padding:3px 7px;background:#555;';
      cancelBtn.onmouseenter = () => (cancelBtn.style.background = '#777');
      cancelBtn.onmouseleave = () => (cancelBtn.style.background = '#555');
      row.append(label, ui.row(acceptBtn, cancelBtn));
      sections.push(row);
    }
  }

  if (outgoing.length) {
    const title = document.createElement('div');
    title.textContent = 'Your offers';
    title.style.cssText =
      'font-weight:bold;font-size:12px;margin-top:8px;margin-bottom:4px;';
    sections.push(title);

    for (const offer of outgoing) {
      const row = document.createElement('div');
      row.style.cssText =
        'display:flex;justify-content:space-between;align-items:center;' +
        'padding:3px 0;border-bottom:1px solid #2a2a2a;font-size:12px;';
      const label = document.createElement('span');
      label.textContent = `→ ${offer.to}: ${offerLabel(offer)}`;
      const cancelBtn = ui.button('Cancel', () =>
        engine.sendServerEvent('trade:cancel', { player: offer.to }),
      );
      cancelBtn.style.cssText +=
        'font-size:11px;padding:3px 7px;background:#555;';
      cancelBtn.onmouseenter = () => (cancelBtn.style.background = '#777');
      cancelBtn.onmouseleave = () => (cancelBtn.style.background = '#555');
      row.append(label, cancelBtn);
      sections.push(row);
    }
  }

  if (!incoming.length && !outgoing.length) {
    const empty = document.createElement('div');
    empty.textContent = 'No active trades.';
    empty.style.cssText = 'color:#888;font-size:12px;padding:4px 0;';
    sections.push(empty);
  }

  const sep = document.createElement('div');
  sep.style.cssText = 'border-top:1px solid #333;padding-top:8px;margin-top:8px;';
  const formLabel = document.createElement('div');
  formLabel.textContent = 'Send offer';
  formLabel.style.cssText = 'font-weight:bold;font-size:12px;margin-bottom:4px;';
  sep.append(formLabel, toInput, ui.row(giveItem, giveQty), ui.row(wantItem, wantQty), sendBtn);
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
  engine.chat(`Trade with ${other} completed.`);
  const msg = document.createElement('div');
  msg.textContent = `Trade complete with ${other}!`;
  msg.style.cssText =
    'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
    'background:#27ae60;color:#fff;padding:8px 16px;border-radius:6px;' +
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
