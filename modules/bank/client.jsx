// @ts-check
// Bank module, client entry. The bank window opens when the player steps
// on a bank tile (the server sends bank:open). There is no action button:
// the bank is only reached at its place on the map.

// Translations keyed by the English text. `ui` helpers translate on their
// own; other text goes through engine.t or engine.useT().
engine.i18n({
  pt: {
    Bank: 'Banco',
    'Slots: {used}/{max}': 'Espaços: {used}/{max}',
    Empty: 'Vazio',
    '↓ Withdraw': '↓ Sacar',
    Qty: 'Qtd',
    'Item ID': 'ID do item',
    Deposit: 'Depositar',
    'Deposit: Item ID, Qty': 'Depositar: ID do item, Qtd',
  },
});

const { useState } = React;
const ui = engine.ui;
const send = engine.sendServerEvent;

const row = { display: 'flex', gap: 6 };

// The module's state lives here, outside React: the server changes it, and
// every change redraws.
let bank = { items: [], maxCapacity: 50 }; // items: [{ item, quantity }]
let shown = false;

function draw() {
  engine.render(shown && <BankWindow />);
}

function hide() {
  shown = false;
  draw();
}

function BankWindow() {
  const t = engine.useT();
  // Qty is shared: it sizes a withdrawal from any row as well as a deposit.
  const [quantity, setQuantity] = useState('1');
  const [itemId, setItemId] = useState('');
  const amount = Number(quantity) || 1;
  const deposit = () => {
    const item = Number(itemId);
    if (!(item > 0)) return;
    send('bank:deposit', { itemId: item, quantity: amount });
    setItemId('');
  };
  return (
    <ui.Window title={t('Bank')} onClose={hide}>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
        {t('Slots: {used}/{max}', {
          used: bank.items.length,
          max: bank.maxCapacity,
        })}
      </div>
      <div style={{ maxHeight: 180, overflowY: 'auto', marginBottom: 8 }}>
        {bank.items.length === 0 ? (
          <div
            style={{
              color: 'var(--color-text-muted)',
              fontSize: 12,
              padding: '4px 0',
            }}
          >
            {t('Empty')}
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {bank.items.map((entry) => (
              <li
                key={entry.item}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '3px 0',
                  borderBottom: '1px solid var(--color-surface-muted)',
                  fontSize: 13,
                }}
              >
                <span>
                  #{entry.item} ×{entry.quantity}
                </span>
                <button
                  type="button"
                  style={{ padding: '3px 7px', fontSize: 11 }}
                  onClick={() =>
                    send('bank:withdraw', {
                      itemId: entry.item,
                      quantity: amount,
                    })
                  }
                >
                  {t('↓ Withdraw')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div
        style={{ borderTop: '1px solid var(--color-border)', paddingTop: 8 }}
      >
        <div
          style={{
            fontSize: 11,
            color: 'var(--color-text-muted)',
            marginBottom: 4,
          }}
        >
          {t('Deposit: Item ID, Qty')}
        </div>
        <div style={row}>
          <input
            type="number"
            min="1"
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
            placeholder={t('Item ID')}
            style={{ width: 80 }}
          />
          <input
            type="number"
            min="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder={t('Qty')}
            style={{ width: 60 }}
          />
          <button type="button" className="button-primary" onClick={deposit}>
            {t('Deposit')}
          </button>
        </div>
      </div>
    </ui.Window>
  );
}

engine.onServerEvent('bank:open', () => {
  shown = true;
  draw();
  send('bank:request');
});

engine.onServerEvent('bank:update', (data) => {
  if (data && Array.isArray(data.items)) bank = data;
  draw();
});
