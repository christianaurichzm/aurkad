// @ts-check
// Crafting module, client entry. The server sends crafting:open when the
// player steps on or talks to something with the `workbench` behaviour, so
// there is no action button.

// Translations keyed by the English text. `ui` helpers translate on their
// own; other text goes through engine.t or engine.useT().
engine.i18n({
  pt: {
    Crafting: 'Fabricação',
    'You know no recipes.': 'Você não conhece nenhuma receita.',
    Craft: 'Fabricar',
    'Missing {items}': 'Falta {items}',
  },
});

const ui = engine.ui;
const send = engine.sendServerEvent;

// The module's state lives here, outside React: the server changes it, and
// every change redraws.
let recipes = [];
let shown = false;

function draw() {
  engine.render(shown && <CraftingWindow />);
}

function hide() {
  shown = false;
  draw();
}

// The server's own answer is reused: the client has no say in whether a
// craft is affordable.
const affordable = (recipe) => (recipe.missing || []).length === 0;

const amount = (entry) =>
  '#' + entry.itemId + (entry.quantity > 1 ? ' ×' + entry.quantity : '');

function CraftingWindow() {
  const t = engine.useT();
  return (
    <ui.Window title={t('Crafting')} onClose={hide}>
      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
        {recipes.length === 0 ? (
          <div
            style={{
              color: 'var(--color-text-muted)',
              fontSize: 12,
              padding: '4px 0',
            }}
          >
            {t('You know no recipes.')}
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {recipes.map((recipe) => (
              <Recipe key={recipe.id} recipe={recipe} />
            ))}
          </ul>
        )}
      </div>
    </ui.Window>
  );
}

function Recipe({ recipe }) {
  const t = engine.useT();
  const ready = affordable(recipe);
  return (
    <li
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '5px 0',
        borderBottom: '1px solid var(--color-surface-muted)',
        fontSize: 13,
        opacity: ready ? undefined : 0.55,
      }}
    >
      <div>
        <div>
          {recipe.name}
          {recipe.output.quantity > 1 ? ' ×' + recipe.output.quantity : ''}
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          {recipe.inputs.map(amount).join(' + ')}
        </div>
      </div>
      {/* Greyed rather than hidden: a recipe you cannot afford yet is the
          reason to go and get the materials, so it has to stay visible. */}
      <button
        type="button"
        className="button-primary"
        style={{ padding: '3px 9px', fontSize: 11 }}
        disabled={!ready}
        title={
          ready
            ? undefined
            : t('Missing {items}', {
                items: recipe.missing
                  .map(
                    (m) =>
                      '#' + m.itemId + ' (' + m.held + '/' + m.quantity + ')',
                  )
                  .join(', '),
              })
        }
        onClick={() => send('crafting:craft', { recipeId: recipe.id })}
      >
        {t('Craft')}
      </button>
    </li>
  );
}

engine.onServerEvent('crafting:open', () => {
  shown = true;
  draw();
  send('crafting:request');
});

engine.onServerEvent('crafting:update', (data) => {
  if (Array.isArray(data)) recipes = data;
  draw();
});
