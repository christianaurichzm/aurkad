import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { loadClientModule } from '../../../test/clientModule';

// The shipped modules/bank/client.jsx, compiled and loaded the way the
// browser gets it.

let mod: ReturnType<typeof loadClientModule>;

beforeEach(() => {
  document.body.innerHTML = '';
  mod = loadClientModule('bank');
});

const emit = (channel: string, payload?: unknown) =>
  act(() => mod.handlers.get(channel)!(payload));
const sent = () =>
  (
    mod.engine.sendServerEvent as unknown as {
      mock: { calls: [string, unknown?][] };
    }
  ).mock.calls;

const BANK = {
  maxCapacity: 50,
  items: [
    { item: 5, quantity: 12 },
    { item: 8, quantity: 1 },
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

  it('lists the slots used and withdraws the quantity typed', () => {
    emit('bank:update', BANK);
    emit('bank:open');
    expect(screen.getByText('Slots: 2/50')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Qty'), {
      target: { value: '4' },
    });
    const [first] = screen.getAllByRole('listitem');
    fireEvent.click(within(first).getByRole('button', { name: '↓ Withdraw' }));
    expect(sent()).toContainEqual([
      'bank:withdraw',
      { itemId: 5, quantity: 4 },
    ]);
  });

  it('deposits only with an item id, and keeps a half-typed one through an update', () => {
    emit('bank:open');
    expect(screen.getByText('Empty')).toBeTruthy();
    const deposit = screen.getByRole('button', { name: 'Deposit' });
    fireEvent.click(deposit);
    expect(sent().some(([channel]) => channel === 'bank:deposit')).toBe(false);
    fireEvent.change(screen.getByPlaceholderText('Item ID'), {
      target: { value: '5' },
    });
    fireEvent.change(screen.getByPlaceholderText('Qty'), {
      target: { value: '3' },
    });
    emit('bank:update', BANK);
    expect(screen.getByPlaceholderText('Item ID')).toHaveProperty('value', '5');
    fireEvent.click(deposit);
    expect(sent()).toContainEqual(['bank:deposit', { itemId: 5, quantity: 3 }]);
  });
});
