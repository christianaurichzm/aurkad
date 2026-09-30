// @ts-check
// Trade module, client entry. The Trade button (T) opens a window with
// incoming offers to accept and a form for a new offer. Clicking another
// player on the canvas fills in the player name.

// Translations keyed by the English text; components use engine.useT()
// and other text engine.t.
engine.i18n({
  pt: {
    Trade: 'Troca',
    'Player name': 'Nome do jogador',
    'Give item ID': 'ID do item ofertado',
    Qty: 'Qtd',
    'Want item ID (opt)': 'ID do item desejado (opc)',
    'Send Offer': 'Enviar oferta',
    Accept: 'Aceitar',
    Decline: 'Recusar',
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
const send = engine.sendServerEvent;

const row = { display: 'flex', gap: 6 };
const small = { padding: '3px 7px', fontSize: 11 };
const heading = { fontWeight: 'bold', fontSize: 12 };
const offerList = { listStyle: 'none', margin: 0, padding: 0 };
const offerRow = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  padding: '3px 0',
  borderBottom: '1px solid var(--color-surface-muted)',
  fontSize: 12,
};

// The module's state lives here, outside React: the server, the Actions menu
// and the rest of the game change it, and every change redraws.
let shown = false;
let myName = null;
let offers = [];
// The form is kept here rather than in the window: the game fills it from
// outside (a player picked on the canvas, an item clicked in the inventory)
// whether or not the window is open, and what was typed stays put when the
// window is closed and opened again.
let form = { to: '', giveItem: '', giveQty: '1', wantItem: '', wantQty: '1' };

function draw() {
  engine.render(
    shown && <TradeWindow me={myName} offers={offers} form={form} />,
  );
}

// However the window opens or closes, the inventory hears it: while it is open
// every item there carries a button that offers it here.
function show(open) {
  shown = open;
  draw();
  window.dispatchEvent(
    new CustomEvent(open ? 'trade:active' : 'trade:inactive'),
  );
  if (open) send('trade:request');
}

function fill(patch) {
  form = { ...form, ...patch };
  draw();
}

function offerLabel(t, offer) {
  const giveName = offer.give.name || `#${offer.give.itemId}`;
  const give = `${giveName}×${offer.give.quantity}`;
  if (!offer.want) return t('{give} (gift)', { give });
  const wantName = offer.want.name || `#${offer.want.itemId}`;
  return t('{give} for {want}', {
    give,
    want: `${wantName}×${offer.want.quantity}`,
  });
}

function TradeWindow({ me, offers, form }) {
  const t = engine.useT();
  const incoming = offers.filter((o) => o.to === me);
  const outgoing = offers.filter((o) => o.from === me);
  return (
    <ui.Window title={t('Trade')} onClose={() => show(false)}>
      {incoming.length > 0 && (
        <div>
          <div style={heading}>{t('Incoming offers')}</div>
          <ul aria-label={t('Incoming offers')} style={offerList}>
            {incoming.map((offer) => (
              <li key={offer.from} style={offerRow}>
                <span>{`${offer.from}: ${offerLabel(t, offer)}`}</span>
                <span style={row}>
                  <button
                    type="button"
                    style={small}
                    onClick={() => send('trade:accept', { from: offer.from })}
                  >
                    {t('Accept')}
                  </button>
                  <button
                    type="button"
                    className="button-danger"
                    style={small}
                    title={t('Decline')}
                    aria-label={t('Decline')}
                    onClick={() => send('trade:cancel', { player: offer.from })}
                  >
                    ✕
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {outgoing.length > 0 && (
        <div>
          <div style={heading}>{t('Your offers')}</div>
          <ul aria-label={t('Your offers')} style={offerList}>
            {outgoing.map((offer) => (
              <li key={offer.to} style={offerRow}>
                <span>{`→ ${offer.to}: ${offerLabel(t, offer)}`}</span>
                <button
                  type="button"
                  className="button-danger"
                  style={small}
                  onClick={() => send('trade:cancel', { player: offer.to })}
                >
                  {t('Cancel')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!incoming.length && !outgoing.length && (
        <div
          style={{
            color: 'var(--color-text-muted)',
            fontSize: 12,
            padding: '4px 0',
          }}
        >
          {t('No active trades.')}
        </div>
      )}
      <OfferForm form={form} />
    </ui.Window>
  );
}

function OfferForm({ form }) {
  const t = engine.useT();
  /** @param {keyof typeof form} key */
  const field = (key) => ({
    value: form[key],
    onChange: (e) => fill({ [key]: e.target.value }),
  });
  const sendOffer = () => {
    const payload = {
      to: form.to.trim(),
      giveItemId: Number(form.giveItem),
      giveQty: Number(form.giveQty) || 1,
      wantItemId: form.wantItem ? Number(form.wantItem) : undefined,
      wantQty: form.wantItem ? Number(form.wantQty) || 1 : undefined,
    };
    if (payload.to && payload.giveItemId > 0) send('trade:offer', payload);
  };
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        borderTop: '1px solid var(--color-border)',
        paddingTop: 8,
        marginTop: 8,
      }}
    >
      <div style={heading}>{t('Send offer')}</div>
      <input {...field('to')} placeholder={t('Player name')} />
      <div style={row}>
        <input
          type="number"
          style={{ width: 80 }}
          {...field('giveItem')}
          placeholder={t('Give item ID')}
        />
        <input
          type="number"
          style={{ width: 50 }}
          {...field('giveQty')}
          placeholder={t('Qty')}
        />
      </div>
      <div style={row}>
        <input
          type="number"
          style={{ width: 80 }}
          {...field('wantItem')}
          placeholder={t('Want item ID (opt)')}
        />
        <input
          type="number"
          style={{ width: 50 }}
          {...field('wantQty')}
          placeholder={t('Qty')}
        />
      </div>
      <button type="button" className="button-primary" onClick={sendOffer}>
        {t('Send Offer')}
      </button>
    </div>
  );
}

ui.actionButton('Trade', () => show(!shown), 't', 'trade', 70);

window.addEventListener('inventory:item-for-trade', function (e) {
  const detail = /** @type {CustomEvent} */ (e).detail;
  fill({ giveItem: String(detail.itemId), giveQty: '1' });
});

engine.onServerEvent('trade:update', (data) => {
  if (!data || !Array.isArray(data.offers)) return;
  myName = data.player;
  offers = data.offers;
  draw();
});

engine.onServerEvent('trade:complete', (offer) => {
  const other = offer.from === myName ? offer.to : offer.from;
  engine.chat(engine.t('Trade with {player} completed.', { player: other }));
  ui.notice(engine.t('Trade complete with {player}!', { player: other }), {
    tone: 'primary',
  });
  send('trade:request');
});

engine.registerPlayerAction('Trade', (name) => {
  form = { ...form, to: name };
  show(true);
});

send('trade:request');
