// @ts-check
// Auction module, client entry: tabs for what is for sale, what this player
// has up, and a form to sell. Item names come with the listings, since the
// client holds no item catalogue.

// Translations keyed by the English text; components use engine.useT().
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
    Item: 'Item',
    Quantity: 'Quantidade',
    Price: 'Preço',
    'Nothing is up for auction.': 'Nada em leilão.',
    'You have nothing up.': 'Você não tem nada anunciado.',
    'Nothing you can sell.': 'Nada que você possa vender.',
    'by {seller}': 'de {seller}',
    'Fee: {percent}%': 'Taxa: {percent}%',
    'You get {payout}': 'Você recebe {payout}',
  },
  es: {
    Auction: 'Subasta',
    'Auction ({count})': 'Subasta ({count})',
    Browse: 'Explorar',
    Mine: 'Míos',
    Sell: 'Vender',
    Buy: 'Comprar',
    Cancel: 'Cancelar',
    List: 'Anunciar',
    Item: 'Objeto',
    Quantity: 'Cantidad',
    Price: 'Precio',
    'Nothing is up for auction.': 'No hay nada en subasta.',
    'You have nothing up.': 'No tienes nada anunciado.',
    'Nothing you can sell.': 'No tienes nada que puedas vender.',
    'by {seller}': 'de {seller}',
    'Fee: {percent}%': 'Comisión: {percent}%',
    'You get {payout}': 'Recibes {payout}',
  },
});

const { useState } = React;
const ui = engine.ui;
const send = engine.sendServerEvent;

const row = { display: 'flex', gap: 6 };
const muted = { fontSize: 12, color: 'var(--color-text-muted)' };

// The module's state lives here, outside React: the server and the Actions
// menu change it, and every change redraws.
let state = {
  listings: [],
  mine: [],
  inventory: [],
  currency: '',
  feePercent: 0,
};
let tab = 'browse';
let shown = false;

function draw() {
  engine.render(shown && <AuctionWindow s={state} />);
}

// Asks on open too, since listings change while the window is shut.
function toggle() {
  shown = !shown;
  draw();
  if (shown) send('auction:request');
}

function pick(id) {
  tab = id;
  draw();
}

function AuctionWindow({ s }) {
  const t = engine.useT();
  // Held here because the sell tab unmounts when another tab shows.
  const [form, setForm] = useState({ itemId: '', quantity: '1', price: '' });
  return (
    <ui.Window
      title={t('Auction ({count})', { count: s.listings.length })}
      onClose={toggle}
    >
      <div style={row}>
        <TabButton id="browse" label={t('Browse')} />
        <TabButton id="mine" label={t('Mine')} />
        <TabButton id="sell" label={t('Sell')} />
      </div>
      {tab === 'sell' ? (
        <SellForm s={s} form={form} setForm={setForm} />
      ) : (
        <Listings s={s} />
      )}
    </ui.Window>
  );
}

function TabButton({ id, label }) {
  const active = tab === id;
  return (
    <button
      type="button"
      aria-pressed={active}
      style={active ? { borderColor: 'var(--color-primary)' } : undefined}
      onClick={() => pick(id)}
    >
      {label}
    </button>
  );
}

function Listings({ s }) {
  const t = engine.useT();
  const rows =
    tab === 'mine'
      ? s.listings.filter((l) => s.mine.includes(l.id))
      : s.listings;

  if (rows.length === 0) {
    return (
      <div style={{ ...muted, padding: '8px 0' }}>
        {t(
          tab === 'mine'
            ? 'You have nothing up.'
            : 'Nothing is up for auction.',
        )}
      </div>
    );
  }

  return (
    <ul
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        maxHeight: 260,
        overflowY: 'auto',
      }}
    >
      {rows.map((l) => {
        const own = s.mine.includes(l.id);
        return (
          <li
            key={l.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '5px 0',
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <span
                style={{ fontSize: 13 }}
              >{`${l.quantity}x ${t(l.item)}`}</span>
              <span style={{ ...muted, fontSize: 11 }}>
                {t('by {seller}', { seller: l.seller })}
              </span>
            </div>
            <span
              style={{
                fontSize: 12,
                fontWeight: 'bold',
                color: 'var(--color-success)',
              }}
            >
              {`${l.price} ${t(s.currency)}`}
            </span>
            <button
              type="button"
              className={own ? 'button-danger' : 'button-primary'}
              onClick={() =>
                send(own ? 'auction:cancel' : 'auction:buy', { id: l.id })
              }
            >
              {t(own ? 'Cancel' : 'Buy')}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function SellForm({ s, form, setForm }) {
  const t = engine.useT();
  if (s.inventory.length === 0) {
    return (
      <div style={{ ...muted, padding: '8px 0' }}>
        {t('Nothing you can sell.')}
      </div>
    );
  }

  // A picked item that left the inventory falls back to the picker's first
  // entry, which is what gets sent.
  const itemId = s.inventory.some((e) => String(e.itemId) === form.itemId)
    ? form.itemId
    : String(s.inventory[0].itemId);
  const asked = Math.max(0, Math.floor(Number(form.price) || 0));
  const payout = asked - Math.floor((asked * s.feePercent) / 100);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  return (
    <>
      <select value={itemId} onChange={set('itemId')} aria-label={t('Item')}>
        {s.inventory.map((e) => (
          <option key={e.itemId} value={String(e.itemId)}>
            {`${t(e.item)} (${e.quantity})`}
          </option>
        ))}
      </select>
      <div style={row}>
        <input
          value={form.quantity}
          onChange={set('quantity')}
          placeholder={t('Quantity')}
          style={{ flex: 1 }}
        />
        <input
          value={form.price}
          onChange={set('price')}
          placeholder={t('Price')}
          style={{ flex: 1 }}
        />
      </div>
      {s.feePercent ? (
        <span style={{ ...muted, fontSize: 11 }}>
          {`${t('Fee: {percent}%', { percent: s.feePercent })} - ${t('You get {payout}', { payout })}`}
        </span>
      ) : null}
      <button
        type="button"
        className="button-primary"
        disabled={asked < 1}
        onClick={() => {
          send('auction:list', {
            itemId: Number(itemId),
            quantity: Math.max(1, Math.floor(Number(form.quantity) || 1)),
            price: asked,
          });
          setForm({ ...form, price: '' });
        }}
      >
        {t('List')}
      </button>
    </>
  );
}

ui.actionButton('Auction', toggle, 'u', 'auction', 75);

engine.onServerEvent('auction:update', (payload) => {
  if (!payload) return;
  state = payload;
  draw();
});

send('auction:request');
