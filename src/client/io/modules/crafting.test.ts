import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { loadClientModule } from '../../../test/clientModule';

// The shipped modules/crafting/client.jsx, compiled and loaded the way the
// browser gets it.

let mod: ReturnType<typeof loadClientModule>;

beforeEach(() => {
  document.body.innerHTML = '';
  mod = loadClientModule('crafting');
});

const emit = (channel: string, payload?: unknown) =>
  act(() => mod.handlers.get(channel)!(payload));
const sent = () =>
  (
    mod.engine.sendServerEvent as unknown as {
      mock: { calls: [string, unknown?][] };
    }
  ).mock.calls;
const click = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name }));
const materials = () =>
  within(screen.getByRole('article'))
    .getAllByRole('listitem')
    .map((li) => li.textContent);

const RECIPES = [
  {
    id: 'sword',
    name: 'Sword',
    inputs: [
      { itemId: 6, quantity: 3, held: 1, name: 'Iron Ore', sprite: 6 },
      { itemId: 4, quantity: 1, held: 4, name: 'Plank', sprite: 4 },
    ],
    output: {
      itemId: 9,
      quantity: 1,
      name: 'Steel Sword',
      sprite: 9,
      description: 'Holds an edge.',
    },
    missing: [{ itemId: 6, held: 1, quantity: 3, name: 'Iron Ore', sprite: 6 }],
  },
  {
    id: 'plank',
    name: 'Plank',
    inputs: [{ itemId: 2, quantity: 2, held: 8, name: 'Log', sprite: 2 }],
    output: {
      itemId: 4,
      quantity: 4,
      name: 'Plank',
      sprite: 4,
      description: '',
    },
    missing: [],
  },
];

describe('crafting window', () => {
  it('opens when the server says the player is at a workbench, and asks for the recipes', () => {
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mod.actions.size).toBe(0);
    emit('crafting:open');
    expect(screen.getByRole('dialog', { name: 'Crafting' })).toBeTruthy();
    expect(screen.getByText('You know no recipes.')).toBeTruthy();
    expect(sent()).toContainEqual(['crafting:request']);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens on the first recipe the player can afford, and crafts it', () => {
    emit('crafting:open');
    emit('crafting:update', RECIPES);
    expect(screen.getByRole('article', { name: 'Plank' })).toBeTruthy();
    expect(materials()).toEqual(['Log8/2 ✓']);
    click('Craft Plank ×4');
    expect(sent()).toContainEqual(['crafting:craft', { recipeId: 'plank' }]);
  });

  it('keeps a recipe with missing materials in the list, saying what is short', () => {
    emit('crafting:open');
    emit('crafting:update', RECIPES);
    click('Sword');
    expect(
      screen.getByRole('article', { name: 'Sword' }).textContent,
    ).toContain('Holds an edge.');
    expect(materials()).toEqual(['Iron Ore1/3 ✕', 'Plank4/1 ✓']);
    const craft = screen.getByRole('button', { name: 'Missing 2 Iron Ore' });
    expect(craft).toHaveProperty('disabled', true);
  });

  // Crafting the last affordable recipe must not slide the window on to
  // whichever recipe is affordable next.
  it('stays on the recipe that was crafted once its materials are spent', () => {
    emit('crafting:open');
    emit('crafting:update', RECIPES);
    click('Craft Plank ×4');
    emit('crafting:update', [
      { ...RECIPES[1], missing: RECIPES[0].missing },
      { ...RECIPES[0], missing: [] },
    ]);
    expect(screen.getByRole('article', { name: 'Plank' })).toBeTruthy();
  });

  it('says in the window what the server answered', () => {
    emit('crafting:open');
    emit('crafting:update', RECIPES);
    emit('crafting:result', { message: 'Your bag is too full to hold that.' });
    expect(screen.getByRole('status').textContent).toBe(
      'Your bag is too full to hold that.',
    );
    click('Sword');
    expect(screen.queryByRole('status')).toBeNull();
  });
});
