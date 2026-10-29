// @ts-check
// Mail module, client entry: a window (M) with waiting letters to collect
// and a tab to send an item to another player. The server decides whether
// a send or a claim goes through.

// Translations keyed by the English text. `ui` helpers translate on their
// own; other text goes through engine.t or engine.useT().
engine.i18n({
  pt: {
    Mail: 'Correio',
    'Mail sections': 'Seções do correio',
    Inbox: 'Entrada',
    Send: 'Enviar',
    '{count} waiting': '{count} esperando',
    'From {player}': 'De {player}',
    Collect: 'Receber',
    'Collect mail from {player}': 'Receber correio de {player}',
    'Collect all': 'Receber tudo',
    'Collect all ({count})': 'Receber tudo ({count})',
    'Your inbox is empty.': 'Sua caixa está vazia.',
    'Items other players send you arrive here.':
      'Os itens que outros jogadores enviam chegam aqui.',
    Recipient: 'Destinatário',
    'Player name': 'Nome do jogador',
    Item: 'Item',
    pick: 'escolha',
    'Pick from the bag': 'Escolha na bolsa',
    '{slot}: {item} x{count}': '{slot}: {item} x{count}',
    '{slot}: empty': '{slot}: vazio',
    'Note (optional)': 'Recado (opcional)',
    'Your bag - click to attach': 'Sua bolsa - clique para anexar',
    '{count} in bag': '{count} na bolsa',
    'Nothing to send.': 'Nada para enviar.',
    'Items you can mail show up here.':
      'Os itens que você pode enviar aparecem aqui.',
    'Add a recipient': 'Informe o destinatário',
    'Pick an item': 'Escolha um item',
    'Send to {player}': 'Enviar para {player}',
    'Postage: {cost} {item}': 'Postagem: {cost} {item}',
  },
  es: {
    Mail: 'Correo',
    'Mail sections': 'Secciones del correo',
    Inbox: 'Entrada',
    Send: 'Enviar',
    '{count} waiting': '{count} esperando',
    'From {player}': 'De {player}',
    Collect: 'Recibir',
    'Collect mail from {player}': 'Recibir el correo de {player}',
    'Collect all': 'Recibir todo',
    'Collect all ({count})': 'Recibir todo ({count})',
    'Your inbox is empty.': 'Tu bandeja está vacía.',
    'Items other players send you arrive here.':
      'Los objetos que te envían otros jugadores llegan aquí.',
    Recipient: 'Destinatario',
    'Player name': 'Nombre del jugador',
    Item: 'Objeto',
    pick: 'elige',
    'Pick from the bag': 'Elige de la bolsa',
    '{slot}: {item} x{count}': '{slot}: {item} x{count}',
    '{slot}: empty': '{slot}: vacío',
    'Note (optional)': 'Nota (opcional)',
    'Your bag - click to attach': 'Tu bolsa - pulsa para adjuntar',
    '{count} in bag': '{count} en la bolsa',
    'Nothing to send.': 'Nada que enviar.',
    'Items you can mail show up here.':
      'Los objetos que puedes enviar aparecen aquí.',
    'Add a recipient': 'Indica el destinatario',
    'Pick an item': 'Elige un objeto',
    'Send to {player}': 'Enviar a {player}',
    'Postage: {cost} {item}': 'Envío: {cost} {item}',
  },
});

const { useState } = React;
const ui = engine.ui;

const field = { display: 'grid', gap: 3 };

// The module's state lives here, outside React: the server and the Actions
// menu change it, and every change redraws.
// { letters: [{ id, itemId, itemName, sprite, quantity, from, message, sentAt }],
//   maxMessageLength, postage?: { cost, item } }
let mail = { letters: [] };
let shown = false;
let tab = 'inbox';
// What the server answered the last thing the window asked for.
let said = '';

function draw() {
  engine.render(shown && <MailWindow mail={mail} />);
}

function send(channel, payload) {
  said = '';
  engine.sendServerEvent(channel, payload);
}

function toggle() {
  shown = !shown;
  said = '';
  draw();
  if (shown) engine.sendServerEvent('mail:request');
}

function pick(id) {
  tab = id;
  said = '';
  draw();
}

function MailWindow({ mail }) {
  const t = engine.useT();
  // Without what may not change hands.
  const bag = (engine.usePlayer()?.inventory ?? []).filter(
    (entry) => !entry.item.bound,
  );
  // The letter being written, held here so it outlives a tab switch and every
  // redraw the server causes.
  const [to, setTo] = useState('');
  const [attached, setAttached] = useState(null); // { id, quantity }
  const [note, setNote] = useState('');

  const { letters } = mail;
  // An item that left the bag since it was picked is no longer attached.
  const held = attached && bag.find((e) => e.item.id === attached.id);
  const recipient = to.trim();
  const post = () => {
    send('mail:send', {
      to: recipient,
      itemId: attached.id,
      quantity: attached.quantity,
      message: note,
    });
    setAttached(null);
    setNote('');
  };

  return (
    <ui.Window
      title={t('Mail')}
      counter={
        letters.length
          ? t('{count} waiting', { count: letters.length })
          : undefined
      }
      width="regular"
      onClose={toggle}
      footer={
        <div className="window-actions">
          {tab === 'inbox' ? (
            <button
              type="button"
              className="button-primary"
              disabled={letters.length === 0}
              onClick={() => send('mail:claim', {})}
            >
              {letters.length
                ? t('Collect all ({count})', { count: letters.length })
                : t('Collect all')}
            </button>
          ) : (
            <button
              type="button"
              className="button-primary"
              disabled={!recipient || !held}
              onClick={post}
            >
              {!recipient
                ? t('Add a recipient')
                : !held
                  ? t('Pick an item')
                  : t('Send to {player}', { player: recipient })}
            </button>
          )}
        </div>
      }
    >
      <div
        className="window-tabs"
        role="tablist"
        aria-label={t('Mail sections')}
      >
        {['inbox', 'send'].map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => pick(id)}
          >
            {t(id === 'inbox' ? 'Inbox' : 'Send')}
          </button>
        ))}
      </div>
      {tab === 'inbox' ? (
        <Inbox letters={letters} />
      ) : (
        <>
          <label style={field}>
            <span className="window-label">{t('Recipient')}</span>
            <input
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder={t('Player name')}
            />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <Attached
              stack={held ? attached : null}
              item={held?.item}
              max={held?.quantity ?? 1}
              onChange={setAttached}
            />
            <label style={{ ...field, flex: 1, minWidth: 0 }}>
              <span className="window-label">{t('Note (optional)')}</span>
              <textarea
                rows={3}
                value={note}
                maxLength={mail.maxMessageLength}
                style={{ resize: 'none' }}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          </div>
          <span className="window-label">
            {t('Your bag - click to attach')}
          </span>
          {bag.length === 0 ? (
            <ui.EmptyState
              icon="bag"
              title={t('Nothing to send.')}
              hint={t('Items you can mail show up here.')}
            />
          ) : (
            <div className="bag-grid">
              {bag.map(({ item, quantity }) => (
                <ui.ItemSlot
                  key={item.id}
                  item={item}
                  quantity={quantity}
                  selected={attached?.id === item.id}
                  note={
                    quantity > 1
                      ? t('{count} in bag', { count: quantity })
                      : undefined
                  }
                  onSelect={() => setAttached({ id: item.id, quantity: 1 })}
                />
              ))}
            </div>
          )}
          {mail.postage && (
            <span className="window-label">
              {t('Postage: {cost} {item}', mail.postage)}
            </span>
          )}
        </>
      )}
      {said && (
        <p className="window-label" role="status">
          {said}
        </p>
      )}
    </ui.Window>
  );
}

function Inbox({ letters }) {
  const t = engine.useT();
  if (letters.length === 0)
    return (
      <ui.EmptyState
        icon="mail"
        title={t('Your inbox is empty.')}
        hint={t('Items other players send you arrive here.')}
      />
    );
  return (
    <ul className="list">
      {letters.map((letter) => (
        <li key={letter.id} className="list-row">
          <ui.ItemIcon spriteId={letter.sprite ?? 0} size={32} />
          <span className="list-row-text">
            <b>{t('From {player}', { player: letter.from })}</b>
            <small>
              {letter.itemName}{' '}
              <b className="stack-count">x{letter.quantity}</b>
              {letter.message && ` · “${letter.message}”`}
            </small>
          </span>
          <span className="list-row-actions">
            <button
              type="button"
              aria-label={t('Collect mail from {player}', {
                player: letter.from,
              })}
              onClick={() => send('mail:claim', { ids: [letter.id] })}
            >
              {t('Collect')}
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

// What goes with the letter: nothing until an item is picked in the bag under
// it, then the item and how many of it.
function Attached({ stack, item, max, onChange }) {
  const t = engine.useT();
  const label = t('Item');
  return (
    <div style={{ display: 'grid', gap: 3, justifyItems: 'start' }}>
      <span className="window-label">{label}</span>
      <span
        className="item-slot"
        data-empty={item ? undefined : true}
        role="img"
        aria-label={
          item
            ? t('{slot}: {item} x{count}', {
                slot: label,
                item: item.name,
                count: stack.quantity,
              })
            : t('{slot}: empty', { slot: label })
        }
      >
        {item ? (
          <ui.ItemIcon spriteId={item.sprite} />
        ) : (
          <span className="window-label" aria-hidden="true">
            {t('pick')} ↓
          </span>
        )}
      </span>
      {item ? (
        <>
          <b>{item.name}</b>
          <ui.Stepper
            value={stack.quantity}
            max={max}
            onChange={(quantity) => onChange({ ...stack, quantity })}
            label={label}
          />
        </>
      ) : (
        <span className="window-label">{t('Pick from the bag')}</span>
      )}
    </div>
  );
}

ui.actionButton('Mail', toggle, 'm', 'mail', 80);

engine.onServerEvent('mail:update', (data) => {
  const payload = /** @type {any} */ (data);
  mail = payload && Array.isArray(payload.letters) ? payload : { letters: [] };
  draw();
});

engine.onServerEvent('mail:result', (result) => {
  said = String(result?.message ?? '');
  draw();
});
