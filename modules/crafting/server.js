// @ts-check
// Crafting module. Recipes are content (RecipeEditor); what making one
// means lives here.
//
// exchangeItems consumes the inputs and produces the output in one step, so
// a full bag refuses the craft instead of eating the materials.
//
// From a script or another module:
//   const crafting = use('crafting');
//   crafting.craft(player, 'steel-sword');
//   crafting.define({ id: 'x', name: 'X', inputs: [...], output: {...} });

i18n({
  pt: {
    'No such recipe.': 'Receita inexistente.',
    'You have not learned that recipe.':
      'Você ainda não aprendeu essa receita.',
    'Your bag is too full to hold that.':
      'Sua bolsa está cheia demais para isso.',
    'You are missing materials.': 'Faltam materiais.',
    'You crafted {item}.': 'Você fabricou {item}.',
    'Crafted.': 'Fabricado.',
    'Crafting must be used in-game.':
      'A fabricação só funciona dentro do jogo.',
    'You know no recipes.': 'Você não conhece nenhuma receita.',
    'Recipes: {list}': 'Receitas: {list}',
  },
  es: {
    'No such recipe.': 'Esa receta no existe.',
    'You have not learned that recipe.': 'Aún no has aprendido esa receta.',
    'Your bag is too full to hold that.':
      'Tu bolsa está demasiado llena para eso.',
    'You are missing materials.': 'Te faltan materiales.',
    'You crafted {item}.': 'Fabricaste {item}.',
    'Crafted.': 'Fabricado.',
    'Crafting must be used in-game.':
      'La fabricación solo funciona dentro del juego.',
    'You know no recipes.': 'No conoces ninguna receta.',
    'Recipes: {list}': 'Recetas: {list}',
  },
});

const defs = new Map();

/**
 * Authored recipes are read on every call, so an edit applies at once.
 * getRecipes() is an in-memory copy, so the read is cheap.
 */
function allRecipes() {
  const byId = new Map();
  for (const recipe of getRecipes()) byId.set(recipe.id, recipe);
  // Script definitions win over content with the same id.
  for (const [id, recipe] of defs) byId.set(id, recipe);
  return [...byId.values()];
}

function getRecipe(id) {
  return defs.get(id) || getRecipes().find((r) => r.id === String(id));
}

/**
 * Whether the player may see this recipe. A failing condition, or a named
 * predicate nobody registered, hides it instead of failing the craft.
 */
function allowed(player, recipe) {
  if (!recipe.condition) return true;
  const predicate = use('recipeCondition.' + recipe.condition);
  if (typeof predicate !== 'function') {
    error(
      'recipe ' +
        recipe.id +
        ' names unregistered condition ' +
        recipe.condition,
    );
    return false;
  }
  try {
    return !!predicate({ player, recipe });
  } catch (e) {
    error('recipe condition threw: ' + e);
    return false;
  }
}

function available(player) {
  return allRecipes().filter((recipe) => allowed(player, recipe));
}

/** What the player is short of, so the panel can grey a row out. */
function missing(player, recipe) {
  const required = new Map();
  for (const input of recipe.inputs) {
    required.set(
      input.itemId,
      (required.get(input.itemId) || 0) + input.quantity,
    );
  }
  const short = [];
  for (const [itemId, quantity] of required) {
    const held = countItem(player, itemId);
    if (held < quantity) short.push({ itemId, quantity, held });
  }
  return short;
}

function craft(player, recipeId) {
  const recipe = getRecipe(recipeId);
  if (!recipe) return 'No such recipe.';
  if (!allowed(player, recipe)) return 'You have not learned that recipe.';

  const made = exchangeItems(player, recipe.inputs, recipe.output);
  if (!made.ok) {
    return made.reason === 'no-space'
      ? 'Your bag is too full to hold that.'
      : 'You are missing materials.';
  }

  // Crafting destroys and creates items, so it is written at once rather
  // than left for the snapshot loop.
  persistNow(player);
  const name = getItem(recipe.output.itemId);
  sendMessage(
    player,
    t(player, 'You crafted {item}.', {
      item:
        (recipe.output.quantity > 1 ? recipe.output.quantity + 'x ' : '') +
        ((name && name.name) || recipe.name),
    }),
  );
  push(player);
  return 'Crafted.';
}

function define(recipe) {
  if (!recipe || !recipe.id) return;
  defs.set(recipe.id, recipe);
}

/** A line of a recipe, with what the window draws it from. */
function look(entry) {
  const info = getItem(entry.itemId);
  return {
    itemId: entry.itemId,
    quantity: entry.quantity,
    name: info ? info.name : '#' + entry.itemId,
    sprite: info ? info.sprite : 0,
  };
}

function push(player) {
  sendEvent(
    player,
    'crafting:update',
    available(player).map((recipe) => {
      const made = getItem(recipe.output.itemId);
      return {
        id: recipe.id,
        name: recipe.name,
        inputs: recipe.inputs.map((input) => ({
          ...look(input),
          held: countItem(player, input.itemId),
        })),
        output: {
          ...look(recipe.output),
          description: made ? made.description : '',
        },
        missing: missing(player, recipe).map((short) => ({
          ...look(short),
          held: short.held,
        })),
      };
    }),
  );
}

command(
  'craft',
  { description: 'Crafting: /craft <recipe> or /craft list' },
  ({ player, args, reply }) => {
    if (!player) return reply('Crafting must be used in-game.');
    const target = String(args[0] || '').toLowerCase();
    if (!target || target === 'list') {
      const list = available(player);
      if (list.length === 0) return reply('You know no recipes.');
      return reply(
        t(player, 'Recipes: {list}', {
          list: list.map((r) => r.id + ' (' + r.name + ')').join(', '),
        }),
      );
    }
    reply(craft(player, args[0]));
  },
);

on('customAction', ({ player, channel, payload }) => {
  const data = /** @type {any} */ (payload);
  if (channel === 'crafting:craft') {
    const said = craft(player, data && data.recipeId);
    // The refusal goes to the window, since a full bag is not something the
    // materials list shows.
    sendEvent(player, 'crafting:result', { message: t(player, said) });
  } else if (channel === 'crafting:request') push(player);
});

// A workbench is a behaviour attached to a tile trigger or an npc, so the
// map and npc editors place one without code.
attach('workbench', {
  onEnter({ player }) {
    open(player);
  },
  onInteract({ player }) {
    open(player);
  },
});

function open(player) {
  push(player);
  sendEvent(player, 'crafting:open');
}

provide('crafting', {
  list: allRecipes,
  available,
  craft,
  define,
});

log('Crafting module ready.');
