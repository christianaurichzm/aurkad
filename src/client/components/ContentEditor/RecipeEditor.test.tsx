/**
 * Authored recipes, editor side: the form keeps at least one input, folds
 * the output fields into one ingredient and leaves an empty `condition` out.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Recipe } from '../../../shared/types';
import { RecipeEditor } from './RecipeEditor';

const mocks = vi.hoisted(() => ({
  saveRecipe: vi.fn(),
  deleteRecipe: vi.fn(),
}));

vi.mock('../../io/network', () => ({
  saveRecipe: mocks.saveRecipe,
  deleteRecipe: mocks.deleteRecipe,
}));

vi.mock('../ChatPanel', () => ({ chatResultMsg: vi.fn() }));

const setup = (recipes: Recipe[] = []) => {
  render(
    <RecipeEditor
      recipes={recipes}
      loadRecipes={() =>
        Promise.resolve(recipes.map((r) => ({ value: r.id, label: r.name })))
      }
      loadItems={() =>
        Promise.resolve([
          { value: 1, label: '1 - Health Potion' },
          { value: 3, label: '3 - Gold Coin' },
          { value: 8, label: '8 - Steel Sword' },
        ])
      }
      refreshData={vi.fn()}
      onDirtyChange={vi.fn()}
      requestDiscard={() => Promise.resolve(true)}
    />,
  );
};

/** What the save call was handed, once it happened. */
const saved = async (): Promise<Recipe> => {
  await waitFor(() => expect(mocks.saveRecipe).toHaveBeenCalled());
  return mocks.saveRecipe.mock.calls[0][0] as Recipe;
};

beforeEach(() => {
  mocks.saveRecipe.mockReset();
  mocks.saveRecipe.mockResolvedValue({});
});

describe('authoring a recipe', () => {
  it('folds the two output fields into one ingredient', async () => {
    const user = userEvent.setup();
    setup();

    await user.type(screen.getByPlaceholderText('steel-sword'), 'sword');
    await user.type(screen.getByPlaceholderText('Steel Sword'), 'Sword');
    await screen.findAllByRole('option', { name: '3 - Gold Coin' });
    // 0 is the recipe picker, 1 the first input's item, 2 the output's.
    await user.selectOptions(screen.getAllByRole('combobox')[1], '3');
    await user.selectOptions(screen.getAllByRole('combobox')[2], '8');
    const [inputQty, outputQty] = screen.getAllByRole('spinbutton');
    await user.clear(inputQty);
    await user.type(inputQty, '50');
    await user.clear(outputQty);
    await user.type(outputQty, '2');
    await user.click(screen.getByRole('button', { name: 'Create recipe' }));

    const recipe = await saved();
    expect(recipe.id).toBe('sword');
    expect(recipe.inputs).toEqual([{ itemId: 3, quantity: 50 }]);
    expect(recipe.output).toEqual({ itemId: 8, quantity: 2 });
  });

  // An empty condition would name a predicate no script registers, so every
  // craft would be refused.
  it('leaves out a condition the designer never filled in', async () => {
    const user = userEvent.setup();
    setup();

    await user.type(screen.getByPlaceholderText('steel-sword'), 'r');
    await user.click(screen.getByRole('button', { name: 'Create recipe' }));

    expect(await saved()).not.toHaveProperty('condition');
  });

  // The server refuses a recipe with no inputs, so the form keeps at least
  // one input row.
  it('never lets the last input row be removed', async () => {
    const user = userEvent.setup();
    setup();

    expect(screen.queryByTitle('Remove')).toBeNull();

    await user.click(screen.getByRole('button', { name: '+ Add' }));
    expect(screen.getAllByTitle('Remove')).toHaveLength(2);

    await user.click(screen.getAllByTitle('Remove')[0]);
    expect(screen.queryByTitle('Remove')).toBeNull();
  });

  it('flags two rows naming the same item, which the craft cannot pay', async () => {
    const user = userEvent.setup();
    setup();

    await screen.findAllByRole('option', { name: '3 - Gold Coin' });
    await user.click(screen.getByRole('button', { name: '+ Add' }));
    await user.selectOptions(screen.getAllByRole('combobox')[1], '3');
    await user.selectOptions(screen.getAllByRole('combobox')[2], '3');

    await waitFor(() => expect(screen.getAllByText('dup')).toHaveLength(2));
  });
});

describe('editing an existing recipe', () => {
  const stored: Recipe = {
    id: 'steel-sword',
    name: 'Steel Sword',
    inputs: [
      { itemId: 2, quantity: 1 },
      { itemId: 3, quantity: 50 },
    ],
    output: { itemId: 8, quantity: 1 },
    condition: 'knowsSmithing',
  };

  it('round-trips a document without inventing or dropping fields', async () => {
    const user = userEvent.setup();
    setup([stored]);

    await screen.findByRole('option', { name: 'Steel Sword' });
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'steel-sword');
    await user.click(screen.getByRole('button', { name: 'Save recipe' }));

    expect(await saved()).toEqual(stored);
  });
});
