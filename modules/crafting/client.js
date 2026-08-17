// @ts-check
// Crafting module, client entry. The panel opens where crafting happens:
// the server sends crafting:open when the player steps on a tile or talks
// to an npc with the `workbench` behaviour. Like the bank, it has no action
// button, as a workbench is somewhere you stand.

// Strings this module draws, keyed by the English itself: text handed to the
// `ui` helpers is translated for free, the rest goes through engine.t.
engine.i18n({
  pt: {
    Crafting: 'Fabricação',
    'You know no recipes.': 'Você não conhece nenhuma receita.',
    Craft: 'Fabricar',
    'Missing {items}': 'Falta {items}',
  },
});

const ui = engine.ui;
const panel = ui.panel({ title: 'Crafting' });

let recipes = [];

engine.onServerEvent('crafting:open', () => {
  panel.show();
  engine.sendServerEvent('crafting:request');
});

// The server's own answer is reused: the client has no say in whether a
// craft is affordable.
const affordable = (recipe) => (recipe.missing || []).length === 0;

const amount = (entry) =>
  '#' + entry.itemId + (entry.quantity > 1 ? ' ×' + entry.quantity : '');

function render() {
  const list = document.createElement('div');
  list.style.cssText = 'max-height:220px;overflow-y:auto;';

  if (recipes.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = engine.t('You know no recipes.');
    empty.style.cssText = 'color:#888;font-size:12px;padding:4px 0;';
    list.appendChild(empty);
  }

  for (const recipe of recipes) {
    const ready = affordable(recipe);

    const row = document.createElement('div');
    row.style.cssText =
      'display:flex;justify-content:space-between;align-items:center;' +
      'padding:5px 0;border-bottom:1px solid #2a2a2a;font-size:13px;' +
      (ready ? '' : 'opacity:0.55;');

    const text = document.createElement('div');
    const title = document.createElement('div');
    title.textContent =
      recipe.name +
      (recipe.output.quantity > 1 ? ' ×' + recipe.output.quantity : '');
    const cost = document.createElement('div');
    cost.textContent = recipe.inputs.map(amount).join(' + ');
    cost.style.cssText = 'font-size:11px;color:#aaa;';
    text.append(title, cost);

    const craftBtn = ui.button('Craft', () => {
      engine.sendServerEvent('crafting:craft', { recipeId: recipe.id });
    });
    craftBtn.style.cssText += 'font-size:11px;padding:3px 9px;';
    // Greyed rather than hidden: a recipe you cannot afford yet is the reason
    // to go and get the materials, so it has to stay visible.
    craftBtn.disabled = !ready;
    if (!ready) {
      craftBtn.style.cssText += 'cursor:default;';
      craftBtn.title = engine.t('Missing {items}', {
        items: recipe.missing
          .map((m) => '#' + m.itemId + ' (' + m.held + '/' + m.quantity + ')')
          .join(', '),
      });
    }

    row.append(text, craftBtn);
    list.appendChild(row);
  }

  panel.setBody(list);
}

engine.onServerEvent('crafting:update', (data) => {
  if (Array.isArray(data)) recipes = data;
  render();
});

render();
