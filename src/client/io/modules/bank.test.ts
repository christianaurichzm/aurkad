import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { loadClientModule } from '../../../test/clientModule';

// The shipped modules/bank/client.jsx, compiled and loaded the way the
// browser gets it.

const item = (id: number, name: string, more = {}) => ({
  id,
  name,
  sprite: id,
  type: 'consumable',
  effects: [],
  ...more,
});

const rowan = {
  name: 'Rowan',
  inventoryCapacity: 20,
  inventory: [
    { item: item(5, 'Potion'), quantity: 3 },
    { item: item(7, 'Ring'), quantity: 1 },
    { item: item(9, 'Oath', { bound: true }), quantity: 2 },
  ],
};

let mod: ReturnType<typeof loadClientModule>;

beforeEach(() => {
  document.body.innerHTML = '';
  mod = loadClientModule('bank', { getPlayer: () => rowan });
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

const BANK = {
  maxCapacity: 50,
  items: [
    { item: item(5, 'Potion'), quantity: 12 },
    { item: item(8, 'Helm'), quantity: 1 },
  ],
};

describe('bank window', () => {
  it('opens when the server says the player stepped on a bank, and asks for the contents', () => {
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mod.actions.size).toBe(0);
    emit('bank:open');
    expect(screen.getByRole('dialog', { name: 'Bank' })).toBeTruthy();
    expect(sent()).toContainEqual(['bank:request']);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not open on an update alone', () => {
    emit('bank:update', BANK);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows both sides with how full each is', () => {
    emit('bank:update', BANK);
    emit('bank:open');
    const [stored, carried] = screen.getAllByRole('heading', { level: 3 });
    expect(stored.textContent).toBe('Vault2/50');
    expect(carried.textContent).toBe('Bag3/20');
    expect(
      screen.getByRole('button', { name: 'Helm, in the vault' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Oath, 2, in the bag, bound' }),
    ).toBeTruthy();
  });

  it('moves a single item on the click', () => {
    emit('bank:update', BANK);
    emit('bank:open');
    click('Helm, in the vault');
    expect(sent()).toContainEqual([
      'bank:withdraw',
      { itemId: 8, quantity: 1 },
    ]);
    click('Ring, in the bag');
    expect(sent()).toContainEqual(['bank:deposit', { itemId: 7, quantity: 1 }]);
  });

  it('asks how many of a stack, the whole of it unless told otherwise', () => {
    emit('bank:update', BANK);
    emit('bank:open');
    click('Potion, 3, in the bag');
    expect(sent().some(([channel]) => channel === 'bank:deposit')).toBe(false);
    click('One less');
    // The server redrawing the window does not lose the amount.
    emit('bank:update', BANK);
    click('Deposit 2');
    expect(sent()).toContainEqual(['bank:deposit', { itemId: 5, quantity: 2 }]);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();

    click('Potion, 12, in the vault');
    click('Withdraw 12');
    expect(sent()).toContainEqual([
      'bank:withdraw',
      { itemId: 5, quantity: 12 },
    ]);
  });

  it('gives the split up on Cancel', () => {
    emit('bank:update', BANK);
    emit('bank:open');
    click('Potion, 12, in the vault');
    click('Cancel');
    expect(screen.queryByRole('button', { name: /Withdraw/ })).toBeNull();
    expect(sent().some(([channel]) => channel === 'bank:withdraw')).toBe(false);
  });

  it('leaves a bound item to the server, and says what it answered', () => {
    emit('bank:open');
    expect(screen.queryByRole('status')).toBeNull();
    click('Oath, 2, in the bag, bound');
    expect(sent()).toContainEqual(['bank:deposit', { itemId: 9, quantity: 1 }]);
    emit('bank:result', {
      message: 'That item is bound and cannot be banked.',
    });
    expect(screen.getByRole('status').textContent).toBe(
      'That item is bound and cannot be banked.',
    );
  });

  it('draws the free slots of the last row, not the whole vault', () => {
    emit('bank:update', BANK);
    emit('bank:open');
    const dialog = screen.getByRole('dialog');
    // Two rows of seven on each side: 2 and 3 held, the rest free.
    expect(
      within(dialog).getAllByRole('button', { name: /in the/ }),
    ).toHaveLength(5);
    expect(dialog.querySelectorAll('.item-slot[data-empty]')).toHaveLength(23);
  });
});
