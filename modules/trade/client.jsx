// @ts-check
// Trade module, client entry: the Trade button (T) opens waiting offers
// and a form for a new one. Clicking a player on the canvas opens it with
// that player chosen.

// Translations keyed by the English text; components use engine.useT()
// and other text engine.t.
engine.i18n({
  pt: {
    Trade: 'Troca',
    'New offer': 'Nova oferta',
    To: 'Para',
    nearby: 'por perto',
    'Nearby players': 'Jogadores por perto',
    'Player name': 'Nome do jogador',
    'Or type a player name': 'Ou digite o nome de um jogador',
    'You give': 'Você dá',
    'You want': 'Você quer',
    'You want (optional)': 'Você quer (opcional)',
    'Pick from the bag': 'Escolha na bolsa',
    'Leave empty for a gift': 'Deixe vazio para dar de presente',
    pick: 'escolha',
    empty: 'vazio',
    '{slot}: {item} x{count}': '{slot}: {item} x{count}',
    '{slot}: empty': '{slot}: vazio',
    Clear: 'Limpar',
    'Pick a player': 'Escolha um jogador',
    'Pick an item to give': 'Escolha um item para dar',
    'Send offer to {player}': 'Enviar oferta para {player}',
    'Send as gift to {player}': 'Enviar de presente para {player}',
    'Your bag': 'Sua bolsa',
    'All items': 'Todos os itens',
    'Click to fill "{slot}"': 'Clique para preencher "{slot}"',
    'Search items': 'Buscar itens',
    'Nothing to give.': 'Nada para dar.',
    'Items you can trade show up here.':
      'Os itens que você pode trocar aparecem aqui.',
    'No item by that name.': 'Nenhum item com esse nome.',
    '{count} in bag': '{count} na bolsa',
    Incoming: 'Recebidas',
    'Your offers': 'Suas ofertas',
    'No offers yet.': 'Nenhuma oferta ainda.',
    'Send one above; offers from other players land here.':
      'Envie uma acima; as ofertas de outros jogadores chegam aqui.',
    '{player} gives': '{player} dá',
    'You give {player}': 'Você dá a {player}',
    for: 'por',
    'as a gift': 'de presente',
    Accept: 'Aceitar',
    'Not enough': 'Falta item',
    "You don't have enough of what is asked for.":
      'Você não tem o bastante do que foi pedido.',
    Decline: 'Recusar',
    Cancel: 'Cancelar',
    'Trade with {player} completed.': 'Troca com {player} concluída.',
    'Trade complete with {player}!': 'Troca concluída com {player}!',
  },
});

const ui = engine.ui;
const send = engine.sendServerEvent;

// The module's state lives here, outside React: the server, the Actions menu
// and the rest of the game change it, and every change redraws.
let shown = false;
let myName = null;
let offers = [];
// The offer being written lives outside the window, since the game fills
// it from the canvas or the inventory while it is closed. `give` and
// `want` are { id, quantity }; `target` says which a picked item fills.
const EMPTY = { give: null, want: null, target: 'give' };
let form = { to: '', ...EMPTY };
// Everything that can be asked for. The client knows only what it carries,
// so the server lists them when "You want" is first picked.
let catalogue = null;
let asked = false;
// What the server answered the last action with: { ok, message }.
let result = null;
// Whether that answer is to an offer, which a yes clears from the form.
let offering = false;

function draw() {
  engine.render(
    shown && (
      <TradeWindow
        me={myName}
        offers={offers}
        form={form}
        catalogue={catalogue}
        result={result}
      />
    ),
  );
}

// The inventory hears the window open and close, since an item picked
// there while it is open is offered here.
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
  if (form.target === 'want' && !asked) {
    asked = true;
    send('trade:items');
  }
  draw();
}

function act(channel, payload) {
  offering = channel === 'trade:offer';
  result = null;
  send(channel, payload);
}

const section = { display: 'grid', gap: 6, alignContent: 'start' };
const stackStyle = { display: 'inline-flex', alignItems: 'center', gap: 2 };

function Stack({ stack }) {
  const label = `${stack.name} x${stack.quantity}`;
  return (
    <span style={stackStyle} title={label} aria-label={label} role="img">
      <ui.ItemIcon spriteId={stack.sprite ?? 0} size={32} />
      <b className="stack-count">x{stack.quantity}</b>
    </span>
  );
}

function OfferRow({ who, offer, children }) {
  const t = engine.useT();
  return (
    <li className="list-row">
      <b>{who}</b>
      <Stack stack={offer.give} />
      <span className="window-label">
        {offer.want ? t('for') : t('as a gift')}
      </span>
      {offer.want && <Stack stack={offer.want} />}
      <span className="list-row-actions">{children}</span>
    </li>
  );
}

function OfferSlot({
  label,
  hint,
  stack,
  item,
  active,
  max,
  onPick,
  onChange,
}) {
  const t = engine.useT();
  return (
    <div
      className="offer-slot"
      data-active={active || undefined}
      style={{ display: 'grid', gridTemplateColumns: '64px 1fr', gap: 8 }}
    >
      <button
        type="button"
        className="item-slot"
        data-empty={item ? undefined : true}
        aria-pressed={active}
        aria-label={
          item
            ? t('{slot}: {item} x{count}', {
                slot: label,
                item: item.name,
                count: stack.quantity,
              })
            : t('{slot}: empty', { slot: label })
        }
        onClick={onPick}
      >
        {item ? (
          <ui.ItemIcon spriteId={item.sprite} />
        ) : (
          <span className="window-label" aria-hidden="true">
            {active ? `${t('pick')} →` : t('empty')}
          </span>
        )}
      </button>
      <div style={{ ...section, gap: 2, justifyItems: 'start' }}>
        <span className="window-label">{label}</span>
        {item ? (
          <>
            <b>{item.name}</b>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <ui.Stepper
                value={stack.quantity}
                max={max}
                onChange={(quantity) => onChange({ ...stack, quantity })}
                label={label}
              />
              <button
                type="button"
                className="link-button"
                onClick={() => onChange(null)}
              >
                {t('Clear')}
              </button>
            </span>
          </>
        ) : (
          <span className="window-label">{hint}</span>
        )}
      </div>
    </div>
  );
}

function TradeWindow({ me, offers, form, catalogue, result }) {
  const t = engine.useT();
  // Without what may not change hands.
  const bag = (engine.usePlayer()?.inventory ?? []).filter(
    (entry) => !entry.item.bound,
  );
  const [search, setSearch] = React.useState('');

  const incoming = offers.filter((o) => o.to === me);
  const outgoing = offers.filter((o) => o.from === me);
  const nearby = Object.values(engine.getGameState()?.players ?? {})
    .map((p) => p.name)
    .filter((name) => name !== me)
    .slice(0, 6);

  // An item that left the bag since it was picked is no longer on offer.
  const held = form.give && bag.find((e) => e.item.id === form.give.id);
  const wanted =
    form.want && (catalogue ?? []).find((item) => item.id === form.want.id);
  const to = form.to.trim();
  const giving = form.target === 'give';

  const pick = (id) =>
    giving
      ? fill({
          give: { id, quantity: 1 },
          target: form.want ? 'give' : 'want',
        })
      : fill({ want: { id, quantity: 1 } });

  const sendOffer = () =>
    act('trade:offer', {
      to,
      giveItemId: form.give.id,
      giveQty: form.give.quantity,
      wantItemId: wanted ? form.want.id : undefined,
      wantQty: wanted ? form.want.quantity : undefined,
    });

  const found = (catalogue ?? []).filter((item) =>
    item.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <ui.Window title={t('Trade')} width="wide" onClose={() => show(false)}>
      {incoming.length > 0 && (
        <section style={section}>
          <h3 className="window-heading">{t('Incoming')}</h3>
          <ul className="list" aria-label={t('Incoming')}>
            {incoming.map((offer) => {
              const lacking =
                offer.want &&
                (bag.find((e) => e.item.id === offer.want.itemId)?.quantity ??
                  0) < offer.want.quantity;
              return (
                <OfferRow
                  key={offer.from}
                  who={t('{player} gives', { player: offer.from })}
                  offer={offer}
                >
                  <button
                    type="button"
                    className="button-primary"
                    disabled={!!lacking}
                    title={
                      lacking
                        ? t("You don't have enough of what is asked for.")
                        : undefined
                    }
                    onClick={() => act('trade:accept', { from: offer.from })}
                  >
                    {lacking ? t('Not enough') : t('Accept')}
                  </button>
                  <button
                    type="button"
                    onClick={() => act('trade:cancel', { player: offer.from })}
                  >
                    {t('Decline')}
                  </button>
                </OfferRow>
              );
            })}
          </ul>
        </section>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ ...section, gap: 10, flex: '1 1 260px', minWidth: 0 }}>
          <section style={section} aria-label={t('New offer')}>
            <h3 className="window-heading">{t('New offer')}</h3>
            <span className="window-label">{t('To')}</span>
            {nearby.length > 0 && (
              <div
                className="chips"
                role="radiogroup"
                aria-label={t('Nearby players')}
              >
                {nearby.map((name) => (
                  <button
                    key={name}
                    type="button"
                    role="radio"
                    className="chip"
                    aria-checked={to === name}
                    onClick={() => fill({ to: name })}
                  >
                    {name}
                    <small>{t('nearby')}</small>
                  </button>
                ))}
              </div>
            )}
            <input
              type="text"
              value={nearby.includes(form.to) ? '' : form.to}
              placeholder={t(
                nearby.length ? 'Or type a player name' : 'Player name',
              )}
              aria-label={t('Player name')}
              onChange={(e) => fill({ to: e.target.value })}
            />
            <OfferSlot
              label={t('You give')}
              hint={t('Pick from the bag')}
              stack={form.give}
              item={held?.item}
              active={giving}
              max={held?.quantity ?? 1}
              onPick={() => fill({ target: 'give' })}
              onChange={(give) => fill({ give, target: 'give' })}
            />
            <OfferSlot
              label={t('You want (optional)')}
              hint={t('Leave empty for a gift')}
              stack={form.want}
              item={wanted}
              active={!giving}
              max={99}
              onPick={() => fill({ target: 'want' })}
              onChange={(want) => fill({ want, target: 'want' })}
            />
            <button
              type="button"
              className="button-primary"
              disabled={!to || !held}
              onClick={sendOffer}
            >
              {!to
                ? t('Pick a player')
                : !held
                  ? t('Pick an item to give')
                  : t(
                      wanted
                        ? 'Send offer to {player}'
                        : 'Send as gift to {player}',
                      {
                        player: to,
                      },
                    )}
            </button>
            {result && (
              <p
                className={result.ok ? 'window-label' : 'window-error'}
                role={result.ok ? 'status' : 'alert'}
              >
                {result.message}
              </p>
            )}
          </section>

          <section style={section}>
            {outgoing.length > 0 ? (
              <>
                <h3 className="window-heading">{t('Your offers')}</h3>
                <ul className="list" aria-label={t('Your offers')}>
                  {outgoing.map((offer) => (
                    <OfferRow
                      key={offer.to}
                      who={t('You give {player}', { player: offer.to })}
                      offer={offer}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          act('trade:cancel', { player: offer.to })
                        }
                      >
                        {t('Cancel')}
                      </button>
                    </OfferRow>
                  ))}
                </ul>
              </>
            ) : (
              incoming.length === 0 && (
                <ui.EmptyState
                  icon="trade"
                  title={t('No offers yet.')}
                  hint={t(
                    'Send one above; offers from other players land here.',
                  )}
                />
              )
            )}
          </section>
        </div>

        <aside
          className="window-aside"
          style={{ ...section, flex: '0 0 auto' }}
          aria-label={giving ? t('Your bag') : t('All items')}
        >
          <h3 className="window-heading">
            {giving ? t('Your bag') : t('All items')}
          </h3>
          <span className="window-label">
            {t('Click to fill "{slot}"', {
              slot: giving ? t('You give') : t('You want'),
            })}
          </span>
          {!giving && (catalogue ?? []).length > 9 && (
            <input
              type="search"
              value={search}
              placeholder={t('Search items')}
              aria-label={t('Search items')}
              onChange={(e) => setSearch(e.target.value)}
            />
          )}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 64px)',
              gap: 3,
              maxHeight: 265,
              overflowY: 'auto',
            }}
          >
            {giving
              ? bag.map(({ item, quantity }) => (
                  <ui.ItemSlot
                    key={item.id}
                    item={item}
                    quantity={quantity}
                    selected={form.give?.id === item.id}
                    note={
                      quantity > 1
                        ? t('{count} in bag', { count: quantity })
                        : undefined
                    }
                    onSelect={() => pick(item.id)}
                  />
                ))
              : found.map((item) => (
                  <ui.ItemSlot
                    key={item.id}
                    item={item}
                    selected={form.want?.id === item.id}
                    onSelect={() => pick(item.id)}
                  />
                ))}
          </div>
          {giving && bag.length === 0 && (
            <ui.EmptyState
              icon="bag"
              title={t('Nothing to give.')}
              hint={t('Items you can trade show up here.')}
            />
          )}
          {!giving && catalogue && found.length === 0 && (
            <span className="window-label">{t('No item by that name.')}</span>
          )}
        </aside>
      </div>
    </ui.Window>
  );
}

ui.actionButton('Trade', () => show(!shown), 't', 'trade', 70);

window.addEventListener('inventory:item-for-trade', function (e) {
  const detail = /** @type {CustomEvent} */ (e).detail;
  fill({
    give: { id: detail.itemId, quantity: 1 },
    target: form.want ? 'give' : 'want',
  });
});

engine.onServerEvent('trade:update', (data) => {
  if (!data || !Array.isArray(data.offers)) return;
  myName = data.player;
  offers = data.offers;
  draw();
});

engine.onServerEvent('trade:items', (data) => {
  if (!data || !Array.isArray(data.items)) return;
  catalogue = data.items;
  draw();
});

engine.onServerEvent('trade:result', (data) => {
  if (!data) return;
  result = { ok: !!data.ok, message: String(data.message ?? '') };
  if (result.ok && offering) form = { ...form, ...EMPTY };
  offering = false;
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
