import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { loadClientModule } from '../../../test/clientModule';

// The shipped modules/mail/client.jsx, compiled and loaded the way the
// browser gets it.

let mod: ReturnType<typeof loadClientModule>;

beforeEach(() => {
  document.body.innerHTML = '';
  mod = loadClientModule('mail');
});

const emit = (channel: string, payload: unknown) =>
  act(() => mod.handlers.get(channel)!(payload));
const sent = () =>
  (
    mod.engine.sendServerEvent as unknown as {
      mock: { calls: [string, unknown?][] };
    }
  ).mock.calls;
const openWindow = () => act(() => mod.actions.get('Mail')!.click());

const LETTERS = [
  {
    id: 'a1',
    itemId: 7,
    itemName: 'Potion',
    quantity: 3,
    from: 'Bo',
    message: 'get well',
  },
  { id: 'b2', itemId: 9, itemName: 'Key', quantity: 1, from: 'Cy' },
];

describe('mail window', () => {
  it('opens from the Actions menu, asks for the queue, and closes on Escape', () => {
    expect(screen.queryByRole('dialog')).toBeNull();
    openWindow();
    expect(screen.getByRole('dialog', { name: 'Mail' })).toBeTruthy();
    expect(sent()).toContainEqual(['mail:request']);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lists what is waiting and collects one letter or all', () => {
    openWindow();
    expect(screen.getByText('Nothing waiting.')).toBeTruthy();
    emit('mail:update', { letters: LETTERS });
    const [first, second] = screen.getAllByRole('listitem');
    expect(first.textContent).toContain('From Bo');
    expect(first.textContent).toContain('3× Potion');
    expect(first.textContent).toContain('get well');
    fireEvent.click(within(second).getByRole('button', { name: 'Collect' }));
    expect(sent()).toContainEqual(['mail:claim', { ids: ['b2'] }]);
    fireEvent.click(screen.getByRole('button', { name: 'Collect all' }));
    expect(sent()).toContainEqual(['mail:claim', {}]);
  });

  it('sends the item to the recipient and clears item and note', () => {
    openWindow();
    const send = screen.getByRole('button', { name: 'Send' });
    fireEvent.click(send);
    expect(sent().some(([channel]) => channel === 'mail:send')).toBe(false);
    fireEvent.change(screen.getByPlaceholderText('To (player)'), {
      target: { value: ' Bo ' },
    });
    fireEvent.change(screen.getByPlaceholderText('Item ID'), {
      target: { value: '7' },
    });
    fireEvent.change(screen.getByPlaceholderText('Qty'), {
      target: { value: '2' },
    });
    fireEvent.change(screen.getByPlaceholderText('Note (optional)'), {
      target: { value: 'enjoy' },
    });
    fireEvent.click(send);
    expect(sent()).toContainEqual([
      'mail:send',
      { to: 'Bo', itemId: 7, quantity: 2, message: 'enjoy' },
    ]);
    expect(screen.getByPlaceholderText('Item ID')).toHaveProperty('value', '');
    expect(screen.getByPlaceholderText('Note (optional)')).toHaveProperty(
      'value',
      '',
    );
  });

  it('keeps a half-typed letter through an update from the server', () => {
    openWindow();
    fireEvent.change(screen.getByPlaceholderText('To (player)'), {
      target: { value: 'Ca' },
    });
    fireEvent.change(screen.getByPlaceholderText('Note (optional)'), {
      target: { value: 'hel' },
    });
    emit('mail:update', { letters: LETTERS });
    expect(screen.getByPlaceholderText('To (player)')).toHaveProperty(
      'value',
      'Ca',
    );
    expect(screen.getByPlaceholderText('Note (optional)')).toHaveProperty(
      'value',
      'hel',
    );
  });
});
