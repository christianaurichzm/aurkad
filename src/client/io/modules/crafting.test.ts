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

const RECIPES = [
  {
    id: 'plank',
    name: 'Plank',
    inputs: [{ itemId: 2, quantity: 2 }],
    output: { itemId: 4, quantity: 4 },
    missing: [],
  },
  {
    id: 'sword',
    name: 'Sword',
    inputs: [
      { itemId: 6, quantity: 3 },
      { itemId: 4, quantity: 1 },
    ],
    output: { itemId: 9, quantity: 1 },
    missing: [{ itemId: 6, held: 1, quantity: 3 }],
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

  it('crafts a recipe the player can afford', () => {
    emit('crafting:open');
    emit('crafting:update', RECIPES);
    const [plank] = screen.getAllByRole('listitem');
    expect(plank.textContent).toContain('Plank ×4');
    expect(plank.textContent).toContain('#2 ×2');
    fireEvent.click(within(plank).getByRole('button', { name: 'Craft' }));
    expect(sent()).toContainEqual(['crafting:craft', { recipeId: 'plank' }]);
  });

  it('keeps a recipe with missing materials visible but greyed, saying what is short', () => {
    emit('crafting:open');
    emit('crafting:update', RECIPES);
    const sword = within(screen.getAllByRole('listitem')[1]).getByRole(
      'button',
      { name: 'Craft' },
    );
    expect(sword).toHaveProperty('disabled', true);
    expect(sword.title).toBe('Missing #6 (1/3)');
  });
});
