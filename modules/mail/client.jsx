// @ts-check
// Mail module, client entry: a window (M) with waiting letters to collect
// and a form to send an item to another player. The server decides whether
// a send or a claim goes through.

// Translations keyed by the English text. `ui` helpers translate on their
// own; other text goes through engine.t or engine.useT().
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

const { useState } = React;
const ui = engine.ui;
const send = engine.sendServerEvent;

const row = { display: 'flex', gap: 6 };
const small = { padding: '3px 7px', fontSize: 11 };

// The module's state lives here, outside React: the server and the Actions
// menu change it, and every change redraws.
let letters = []; // [{ id, itemId, itemName, quantity, from, message, sentAt }]
let shown = false;

function draw() {
  engine.render(shown && <MailWindow />);
}

function toggle() {
  shown = !shown;
  draw();
  if (shown) send('mail:request');
}

function MailWindow() {
  const t = engine.useT();
  return (
    <ui.Window title={t('Mail')} onClose={toggle}>
      <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 8 }}>
        {letters.length === 0 ? (
          <div
            style={{
              color: 'var(--color-text-muted)',
              fontSize: 12,
              padding: '4px 0',
            }}
          >
            {t('Nothing waiting.')}
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {letters.map((letter) => (
              <Letter key={letter.id} letter={letter} />
            ))}
          </ul>
        )}
      </div>
      <button
        type="button"
        style={small}
        onClick={() => send('mail:claim', {})}
      >
        {t('Collect all')}
      </button>
      <SendForm />
    </ui.Window>
  );
}

function Letter({ letter }) {
  const t = engine.useT();
  return (
    <li
      style={{
        padding: '6px 8px',
        borderRadius: 'var(--radius-control)',
        border: '1px solid var(--color-border)',
        background: 'var(--color-surface-muted)',
        marginBottom: 4,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
          fontSize: 13,
        }}
      >
        <span style={{ fontWeight: 'bold', color: 'var(--color-text)' }}>
          {t('From {player}', { player: letter.from })}
        </span>
        <button
          type="button"
          style={small}
          onClick={() => send('mail:claim', { ids: [letter.id] })}
        >
          {t('Collect')}
        </button>
      </div>
      <div
        style={{ fontSize: 12, color: 'var(--color-warning)', marginTop: 2 }}
      >
        {letter.quantity}× {letter.itemName}
      </div>
      {letter.message && (
        <div
          style={{
            fontSize: 12,
            color: 'var(--color-text-muted)',
            marginTop: 3,
            fontStyle: 'italic',
          }}
        >
          {letter.message}
        </div>
      )}
    </li>
  );
}

function SendForm() {
  const t = engine.useT();
  const [to, setTo] = useState('');
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [message, setMessage] = useState('');
  const submit = () => {
    const recipient = to.trim();
    const item = Number(itemId);
    if (!recipient || !(item > 0)) return;
    send('mail:send', {
      to: recipient,
      itemId: item,
      quantity: Number(quantity) || 1,
      message,
    });
    setItemId('');
    setMessage('');
  };
  return (
    <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 8 }}>
      <div
        style={{
          fontSize: 11,
          color: 'var(--color-text-muted)',
          marginBottom: 4,
        }}
      >
        {t('Send an item')}
      </div>
      <div style={row}>
        <input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder={t('To (player)')}
          style={{ flex: 1 }}
        />
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
      </div>
      <div style={{ ...row, marginTop: 6 }}>
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t('Note (optional)')}
          style={{ flex: 1 }}
        />
        <button type="button" className="button-primary" onClick={submit}>
          {t('Send')}
        </button>
      </div>
    </div>
  );
}

ui.actionButton('Mail', toggle, 'm', 'mail', 80);

engine.onServerEvent('mail:update', (data) => {
  const payload = /** @type {any} */ (data);
  letters = payload && Array.isArray(payload.letters) ? payload.letters : [];
  draw();
});
