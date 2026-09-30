// @ts-check
// Crafting module, client entry. The server sends crafting:open when the
// player steps on or talks to something with the `workbench` behaviour, so
// there is no action button.

// Translations keyed by the English text. `ui` helpers translate on their
// own; other text goes through engine.t or engine.useT().
engine.i18n({
  pt: {
    Crafting: 'Fabricação',
    Recipes: 'Receitas',
    'You know no recipes.': 'Você não conhece nenhuma receita.',
    'Recipes you learn show up here.':
      'As receitas que você aprender aparecem aqui.',
    Materials: 'Materiais',
    '{item}: {held} of {needed}': '{item}: {held} de {needed}',
    'Craft {item}': 'Fabricar {item}',
    'Missing {items}': 'Falta {items}',
  },
});

const ui = engine.ui;

const section = { display: 'grid', gap: 6, alignContent: 'start' };

// The module's state lives here, outside React: the server changes it, and
// every change redraws.
// [{ id, name, inputs: [{ itemId, quantity, held, name, sprite }],
//    output: { itemId, quantity, name, sprite, description },
//    missing: [{ itemId, quantity, held, name, sprite }] }]
let recipes = [];
let shown = false;
let picked = '';
// What the server answered the last thing the window asked for.
let said = '';

function draw() {
  engine.render(shown && <CraftingWindow />);
}

function hide() {
  shown = false;
  draw();
}

function pick(id) {
  picked = id;
  said = '';
  draw();
}

// The server's own answer is reused: the client has no say in whether a
// craft is affordable.
const affordable = (recipe) => (recipe.missing || []).length === 0;

const times = (quantity) => (quantity > 1 ? ' ×' + quantity : '');

function CraftingWindow() {
  const t = engine.useT();
  if (recipes.length === 0)
    return (
      <ui.Window title={t('Crafting')} width="wide" onClose={hide}>
        <ui.EmptyState
          icon="bag"
          title={t('You know no recipes.')}
          hint={t('Recipes you learn show up here.')}
        />
      </ui.Window>
    );
  const open =
    recipes.find((r) => r.id === picked) ??
    recipes.find(affordable) ??
    recipes[0];
  const ready = affordable(open);
  const craft = () => {
    // Stay on the recipe just made, or spending the materials would move the
    // window to the next affordable one.
    pick(open.id);
    engine.sendServerEvent('crafting:craft', { recipeId: open.id });
  };
  return (
    <ui.Window
      title={t('Crafting')}
      width="wide"
      onClose={hide}
      footer={
        <div className="window-actions">
          <button
            type="button"
            className="button-primary"
            disabled={!ready}
            onClick={craft}
          >
            {ready
              ? t('Craft {item}', {
                  item: open.output.name + times(open.output.quantity),
                })
              : t('Missing {items}', {
                  items: open.missing
                    .map((m) => m.quantity - m.held + ' ' + m.name)
                    .join(', '),
                })}
          </button>
        </div>
      }
    >
      <div className="window-split">
        <nav style={section} aria-label={t('Recipes')}>
          <h3 className="window-heading">{t('Recipes')}</h3>
          <ul className="list">
            {recipes.map((recipe) => (
              <li key={recipe.id}>
                {/* Greyed rather than hidden: a recipe you cannot afford yet
                    is the reason to go and get the materials, so it has to
                    stay visible. */}
                <button
                  type="button"
                  className="chip"
                  style={{
                    width: '100%',
                    alignItems: 'center',
                    textAlign: 'left',
                    opacity: affordable(recipe) ? undefined : 0.6,
                  }}
                  aria-current={recipe.id === open.id}
                  onClick={() => pick(recipe.id)}
                >
                  <ui.ItemIcon spriteId={recipe.output.sprite} size={24} />
                  {recipe.name}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <Detail recipe={open} />
      </div>
      {said && (
        <p className="window-label" role="status">
          {said}
        </p>
      )}
    </ui.Window>
  );
}

function Detail({ recipe }) {
  const t = engine.useT();
  const { output } = recipe;
  return (
    <article className="window-aside" style={section} aria-label={recipe.name}>
      <div className="item-detail-head">
        <span className="item-slot">
          <ui.ItemIcon spriteId={output.sprite} />
          {output.quantity > 1 && (
            <span className="item-slot-quantity">{output.quantity}</span>
          )}
        </span>
        <div>
          <h3>{output.name}</h3>
          {output.description && (
            <p className="item-detail-type">{output.description}</p>
          )}
        </div>
      </div>
      <h3 className="window-heading">{t('Materials')}</h3>
      <ul className="list">
        {recipe.inputs.map((input, i) => {
          const short = input.held < input.quantity;
          return (
            <li
              key={i}
              className="list-row"
              aria-label={t('{item}: {held} of {needed}', {
                item: input.name,
                held: input.held,
                needed: input.quantity,
              })}
            >
              <ui.ItemIcon spriteId={input.sprite} size={32} />
              <b style={{ flex: 1, minWidth: 0 }}>{input.name}</b>
              <b
                className="item-compare stack-count"
                data-change={short ? 'down' : 'up'}
              >
                {input.held}/{input.quantity} {short ? '✕' : '✓'}
              </b>
            </li>
          );
        })}
      </ul>
    </article>
  );
}

engine.onServerEvent('crafting:open', () => {
  shown = true;
  said = '';
  draw();
  engine.sendServerEvent('crafting:request');
});

engine.onServerEvent('crafting:update', (data) => {
  if (Array.isArray(data)) recipes = data;
  draw();
});

engine.onServerEvent('crafting:result', (result) => {
  said = String(result?.message ?? '');
  draw();
});
