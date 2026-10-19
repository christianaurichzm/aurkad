/**
 * The recipe cache, read inside the tick when a craft resolves; these cover
 * that it tracks writes instead of going stale until a restart.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Recipe } from '../../../shared/types.js';

const stored: Recipe[] = [];
const findOneAndUpdate = vi.fn();
const deleteOne = vi.fn();

vi.mock('../../model/Recipe.js', () => ({
  default: {
    findOneAndUpdate: (...args: unknown[]) => {
      findOneAndUpdate(...args);
      return Promise.resolve(undefined);
    },
    deleteOne: (...args: unknown[]) => {
      deleteOne(...args);
      return Promise.resolve(undefined);
    },
    find: () => ({ lean: () => ({ exec: () => Promise.resolve(stored) }) }),
  },
}));

const {
  loadRecipes,
  createOrUpdateRecipe,
  deleteRecipe,
  clearRecipeCache,
  cachedRecipes,
  RecipeSchema,
} = await import('./recipeService.js');

const getRecipeById = (id: string) =>
  cachedRecipes().find((entry) => entry.id === id);

const recipe = (id: string): Recipe => ({
  id,
  name: `Recipe ${id}`,
  inputs: [{ itemId: 3, quantity: 10 }],
  output: { itemId: 1, quantity: 1 },
});

beforeEach(() => {
  stored.length = 0;
  clearRecipeCache();
  findOneAndUpdate.mockClear();
  deleteOne.mockClear();
});

describe('loadRecipes', () => {
  it('fills the cache from the database', async () => {
    stored.push(recipe('a'), recipe('b'));

    await loadRecipes();

    expect(cachedRecipes().map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(getRecipeById('a')?.name).toBe('Recipe a');
  });

  it('replaces what was cached rather than merging into it', async () => {
    stored.push(recipe('a'));
    await loadRecipes();

    stored.length = 0;
    stored.push(recipe('b'));
    await loadRecipes();

    expect(getRecipeById('a')).toBeUndefined();
    expect(getRecipeById('b')).toBeDefined();
  });
});

describe('createOrUpdateRecipe', () => {
  // Otherwise lowering a recipe's cost in the editor would leave every player
  // paying the old one until the server was restarted.
  it('makes the new version visible without a reload', async () => {
    await createOrUpdateRecipe(recipe('a'));
    await createOrUpdateRecipe({
      id: 'a',
      name: 'Cheaper',
      inputs: [{ itemId: 3, quantity: 2 }],
      output: { itemId: 1, quantity: 1 },
    });

    expect(getRecipeById('a')?.name).toBe('Cheaper');
    expect(getRecipeById('a')?.inputs[0]?.quantity).toBe(2);
  });

  it('upserts by id', async () => {
    await createOrUpdateRecipe(recipe('a'));

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { id: 'a' },
      expect.objectContaining({ id: 'a' }),
      { upsert: true },
    );
  });

  // Deep, not shallow: the ingredient list is where the cost lives, and an
  // aliased one would let the caller change the price after the save.
  it('does not alias the caller inputs into the cache', async () => {
    const original = recipe('a');
    await createOrUpdateRecipe(original);
    original.inputs[0]!.quantity = 1;

    expect(getRecipeById('a')?.inputs[0]?.quantity).toBe(10);
  });
});

describe('deleteRecipe', () => {
  it('drops it from the cache too', async () => {
    await createOrUpdateRecipe(recipe('a'));
    await deleteRecipe('a');

    expect(getRecipeById('a')).toBeUndefined();
    expect(deleteOne).toHaveBeenCalledWith({ id: 'a' });
  });
});

describe('cachedRecipes', () => {
  it('lists what is loaded', async () => {
    await createOrUpdateRecipe(recipe('a'));
    await createOrUpdateRecipe(recipe('b'));

    expect(
      cachedRecipes()
        .map((r) => r.id)
        .sort(),
    ).toEqual(['a', 'b']);
  });
});

describe('RecipeSchema', () => {
  const valid = {
    id: 'steel-sword',
    name: 'Steel Sword',
    inputs: [{ itemId: 2, quantity: 1 }],
    output: { itemId: 8, quantity: 1 },
  };

  it('accepts a recipe with inputs and an output', () => {
    expect(RecipeSchema.safeParse(valid).success).toBe(true);
  });

  // A recipe consuming nothing prints items out of thin air, the one thing
  // the economy may not do, so it is refused rather than warned about.
  it('rejects a recipe with no inputs', () => {
    expect(RecipeSchema.safeParse({ ...valid, inputs: [] }).success).toBe(
      false,
    );
  });

  it('rejects a zero or negative quantity on either side', () => {
    expect(
      RecipeSchema.safeParse({
        ...valid,
        inputs: [{ itemId: 2, quantity: 0 }],
      }).success,
    ).toBe(false);
    expect(
      RecipeSchema.safeParse({
        ...valid,
        output: { itemId: 8, quantity: -1 },
      }).success,
    ).toBe(false);
  });

  it('keeps the condition, which names a script predicate', () => {
    const result = RecipeSchema.safeParse({
      ...valid,
      condition: 'knowsSmithing',
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ condition: 'knowsSmithing' });
  });
});
