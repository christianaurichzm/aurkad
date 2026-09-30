// @ts-check
// Magic module, client entry. The first eight spells sit on the hotbar,
// cast by click or F1 to F8 with cooldown and mana shown. The Spells button
// opens the spellbook with every spell and what it costs.

// Translations keyed by the English text; components use engine.useT().
// Spell names are content and stay in the operator's language.
engine.i18n({
  pt: {
    Spells: 'Magias',
    'Mana: {mana}/{max}': 'Mana: {mana}/{max}',
    Ready: 'Disponível',
    '{cost} MP': '{cost} MP',
    '{seconds}s cooldown': 'Recarga de {seconds}s',
  },
});

const ui = engine.ui;

let state = null;
let shown = false;

const HOTBAR_SLOTS = 8;

function draw() {
  engine.render(shown && <SpellsWindow s={state} />);
  ui.hotbar(
    state
      ? state.spells.slice(0, HOTBAR_SLOTS).map((spell, i) => ({
          id: spell.id,
          name: spell.name,
          description: spell.description,
          key: `F${i + 1}`,
          icon: spell.icon,
          cost: spell.cost,
          readyAt: spell.readyAt,
          cooldownMs: spell.cooldownMs,
          noMana: state.mana < spell.cost,
          friendly: spell.friendly,
          onUse: () => tryCast(spell),
        }))
      : [],
  );
}

function toggle() {
  shown = !shown;
  draw();
}

ui.actionButton('Spells', toggle, 's', 'spellbook', 30); // S opens/closes

// Casts only when off cooldown and affordable; the spellbook and the
// hotbar share this gate.
function tryCast(spell) {
  if (!spell) return;
  if (spell.readyAt > Date.now()) return; // on cooldown
  if (state.mana < spell.cost) return; // not enough mana
  engine.sendServerEvent('spell:cast', { id: spell.id });
}

function SpellsWindow({ s }) {
  const t = engine.useT();
  // Cooldowns end between server pushes, so the window redraws on a timer.
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);

  const now = Date.now();
  return (
    <ui.Window title={t('Spells')} width={380} onClose={toggle}>
      {s ? (
        <>
          <div>
            {t('Mana: {mana}/{max}', {
              mana: Math.round(s.mana),
              max: s.manaMax,
            })}
          </div>
          <ul
            style={{
              listStyle: 'none',
              margin: '8px 0 0',
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            {s.spells.map((spell, i) => (
              <li key={spell.id}>
                <button
                  type="button"
                  style={{
                    width: '100%',
                    display: 'grid',
                    gridTemplateColumns: '40px 1fr auto',
                    alignItems: 'center',
                    gap: 10,
                    textAlign: 'left',
                  }}
                  disabled={spell.readyAt > now || s.mana < spell.cost}
                  onClick={() => tryCast(spell)}
                >
                  <span
                    style={{
                      width: 40,
                      height: 40,
                      display: 'grid',
                      placeItems: 'center',
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-surface-muted)',
                    }}
                  >
                    <ui.SpellIcon icon={spell.icon} name={spell.name} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <strong style={{ display: 'block' }}>{spell.name}</strong>
                    {spell.description && (
                      <span
                        style={{
                          display: 'block',
                          fontSize: 12,
                          color: 'var(--color-text-muted)',
                        }}
                      >
                        {spell.description}
                      </span>
                    )}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-world)',
                      fontSize: 12,
                      textAlign: 'right',
                    }}
                  >
                    <span
                      style={{ display: 'block', color: 'var(--color-info)' }}
                    >
                      {t('{cost} MP', { cost: spell.cost })}
                    </span>
                    <span
                      style={{
                        display: 'block',
                        color: 'var(--color-text-muted)',
                      }}
                    >
                      {spell.readyAt > now
                        ? `${Math.ceil((spell.readyAt - now) / 1000)}s`
                        : spell.cooldownMs
                          ? t('{seconds}s cooldown', {
                              seconds: spell.cooldownMs / 1000,
                            })
                          : t('Ready')}
                    </span>
                    {i < HOTBAR_SLOTS && (
                      <span
                        style={{
                          display: 'block',
                          color: 'var(--color-text-muted)',
                        }}
                      >
                        {`F${i + 1}`}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        '…'
      )}
    </ui.Window>
  );
}

engine.onServerEvent('magic:update', (s) => {
  state = s;
  draw();
});

engine.sendServerEvent('magic:request');
