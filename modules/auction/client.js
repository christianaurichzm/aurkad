// @ts-check
// Auction module, client entry: tabs for what is for sale, what this
// player has up, and a form to sell. Item names come with the listings,
// since the client holds no item catalogue.

engine.i18n({
  pt: {
    Auction: 'Leilão',
    'Auction ({count})': 'Leilão ({count})',
    Browse: 'Ver',
    Mine: 'Meus',
    Sell: 'Vender',
    Buy: 'Comprar',
    Cancel: 'Cancelar',
    List: 'Anunciar',
    Quantity: 'Quantidade',
    Price: 'Preço',
    'Nothing is up for auction.': 'Nada em leilão.',
    'You have nothing up.': 'Você não tem nada anunciado.',
    'Nothing you can sell.': 'Nada que você possa vender.',
    'by {seller}': 'de {seller}',
    'Fee: {percent}%': 'Taxa: {percent}%',
    'You get {payout}': 'Você recebe {payout}',
  },
});

// The toolkit panel is light (src/client/theme.ts: surface #fff, text #333,
// border #ddd); a module gets no import of that file, so it is written here.
const TEXT = '#333333';
const MUTED = '#666666';
const LINE = '#dddddd';
const PRICE = '#217a3a';

const ui = engine.ui;
const panel = ui.panel({ title: 'Auction' });

// Asking on open, not only on load: somebody else's listing can appear or sell
// while the panel is shut.
ui.actionButton(
  'Auction',
  () => {
    panel.toggle();
    if (panel.isOpen()) engine.sendServerEvent('auction:request');
  },
  'u',
);

let state = {
  listings: [],
  mine: [],
  inventory: [],
  currency: '',
  feePercent: 0,
};
let tab = 'browse';

function span(text, css) {
  const el = document.createElement('span');
  el.textContent = text;
  el.style.cssText = css;
  return el;
}

function emptyLine(text) {
  const el = document.createElement('div');
  el.textContent = engine.t(text);
  el.style.cssText = `font:12px sans-serif;color:${MUTED};padding:8px 0;`;
  return el;
}

function listingRow(listing, action) {
  const line = document.createElement('div');
  line.style.cssText =
    `display:flex;align-items:center;gap:8px;padding:5px 0;` +
    `border-bottom:1px solid ${LINE};`;

  const left = document.createElement('div');
  left.style.cssText = 'flex:1;display:flex;flex-direction:column;';
  left.append(
    span(
      `${listing.quantity}x ${engine.t(listing.item)}`,
      `font:13px sans-serif;color:${TEXT};`,
    ),
    span(
      engine.t('by {seller}', { seller: listing.seller }),
      `font:11px sans-serif;color:${MUTED};`,
    ),
  );

  line.append(
    left,
    span(
      `${listing.price} ${engine.t(state.currency)}`,
      `font:bold 12px sans-serif;color:${PRICE};`,
    ),
    action,
  );
  return line;
}

function browseBody() {
  const list = document.createElement('div');
  list.style.cssText = 'max-height:260px;overflow-y:auto;';
  const rows =
    tab === 'mine'
      ? state.listings.filter((l) => state.mine.includes(l.id))
      : state.listings;

  if (rows.length === 0) {
    list.append(
      emptyLine(
        tab === 'mine' ? 'You have nothing up.' : 'Nothing is up for auction.',
      ),
    );
    return list;
  }

  for (const listing of rows) {
    const own = state.mine.includes(listing.id);
    const button = ui.button(own ? 'Cancel' : 'Buy', () =>
      engine.sendServerEvent(own ? 'auction:cancel' : 'auction:buy', {
        id: listing.id,
      }),
    );
    list.append(listingRow(listing, button));
  }
  return list;
}

function sellBody() {
  if (state.inventory.length === 0) return emptyLine('Nothing you can sell.');

  const box = document.createElement('div');
  box.style.cssText = 'display:flex;flex-direction:column;gap:6px;';

  const picker = document.createElement('select');
  picker.style.cssText =
    `width:100%;padding:6px 8px;border:1px solid ${LINE};border-radius:4px;` +
    `font:13px sans-serif;background:#fff;color:${TEXT};box-sizing:border-box;`;
  for (const entry of state.inventory) {
    const option = document.createElement('option');
    option.value = String(entry.itemId);
    option.textContent = `${engine.t(entry.item)} (${entry.quantity})`;
    picker.append(option);
  }

  const quantity = ui.input('Quantity');
  quantity.value = '1';
  const price = ui.input('Price');

  const note = span('', `font:11px sans-serif;color:${MUTED};`);
  const refreshNote = () => {
    const asked = Math.max(0, Math.floor(Number(price.value) || 0));
    const payout = asked - Math.floor((asked * state.feePercent) / 100);
    note.textContent = state.feePercent
      ? `${engine.t('Fee: {percent}%', { percent: state.feePercent })} - ${engine.t('You get {payout}', { payout })}`
      : '';
  };
  price.addEventListener('input', refreshNote);
  refreshNote();

  box.append(
    picker,
    ui.row(quantity, price),
    note,
    ui.button('List', () => {
      const asked = Math.floor(Number(price.value) || 0);
      if (asked < 1) return;
      engine.sendServerEvent('auction:list', {
        itemId: Number(picker.value),
        quantity: Math.max(1, Math.floor(Number(quantity.value) || 1)),
        price: asked,
      });
      price.value = '';
    }),
  );
  return box;
}

function tabButton(id, label) {
  const b = ui.button(label, () => {
    tab = id;
    render();
  });
  if (tab === id) b.style.outline = `2px solid ${TEXT}`;
  return b;
}

function render() {
  panel.setTitle(
    engine.t('Auction ({count})', { count: state.listings.length }),
  );
  panel.setBody(
    ui.row(
      tabButton('browse', 'Browse'),
      tabButton('mine', 'Mine'),
      tabButton('sell', 'Sell'),
    ),
    tab === 'sell' ? sellBody() : browseBody(),
  );
}

engine.onServerEvent('auction:update', (payload) => {
  if (!payload) return;
  state = payload;
  render();
});

engine.sendServerEvent('auction:request');
render();
