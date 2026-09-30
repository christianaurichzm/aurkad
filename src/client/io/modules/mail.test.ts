import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { loadClientModule } from '../../../test/clientModule';

// The shipped modules/mail/client.jsx, compiled and loaded the way the
// browser gets it.

const potion = { id: 7, name: 'Potion', sprite: 3, type: 'consumable' };
const relic = { id: 8, name: 'Relic', sprite: 4, type: 'misc', bound: true };

let mod: ReturnType<typeof loadClientModule>;

beforeEach(() => {
  document.body.innerHTML = '';
  mod = loadClientModule('mail', {
    getPlayer: () => ({
      name: 'Ana',
      inventory: [
        { item: potion, quantity: 3 },
        { item: relic, quantity: 1 },
      ],
    }),
  });
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
const click = (name: string | RegExp) =>
  fireEvent.click(screen.getByRole('button', { name }));
const tab = (name: string) =>
  fireEvent.click(screen.getByRole('tab', { name }));

const LETTERS = [
  {
    id: 'a1',
    itemId: 7,
    itemName: 'Potion',
    sprite: 3,
    quantity: 3,
    from: 'Bo',
    message: 'get well',
  },
  { id: 'b2', itemId: 9, itemName: 'Key', sprite: 5, quantity: 1, from: 'Cy' },
];

describe('the inbox', () => {
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
    expect(screen.getByText('Your inbox is empty.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Collect all' })).toHaveProperty(
      'disabled',
      true,
    );

    emit('mail:update', { letters: LETTERS });
    expect(screen.getByRole('dialog').textContent).toContain('2 waiting');
    const [first] = screen.getAllByRole('listitem');
    expect(first.textContent).toBe('From BoPotion x3 · “get well”Collect');
    click('Collect mail from Cy');
    expect(sent()).toContainEqual(['mail:claim', { ids: ['b2'] }]);
    click('Collect all (2)');
    expect(sent()).toContainEqual(['mail:claim', {}]);
  });

  it('says in the window what the server answered', () => {
    openWindow();
    emit('mail:result', { message: 'Your inventory is full.' });
    expect(screen.getByRole('status').textContent).toBe(
      'Your inventory is full.',
    );
  });
});

describe('sending', () => {
  beforeEach(() => {
    openWindow();
    emit('mail:update', {
      letters: [],
      maxMessageLength: 140,
      postage: { cost: 2, item: 'Gold' },
    });
    tab('Send');
  });

  it('offers the bag without what is bound, and says what postage costs', () => {
    expect(screen.getByRole('button', { name: /^Potion/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Relic/ })).toBeNull();
    expect(screen.getByText('Postage: 2 Gold')).toBeTruthy();
  });

  it('says on the button what the letter still lacks', () => {
    expect(
      screen.getByRole('button', { name: 'Add a recipient' }),
    ).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByPlaceholderText('Player name'), {
      target: { value: ' Bo ' },
    });
    expect(screen.getByRole('button', { name: 'Pick an item' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('sends the picked item to the recipient and clears item and note', () => {
    fireEvent.change(screen.getByPlaceholderText('Player name'), {
      target: { value: ' Bo ' },
    });
    click(/^Potion/);
    click('One more');
    fireEvent.change(screen.getByLabelText('Note (optional)'), {
      target: { value: 'enjoy' },
    });
    click('Send to Bo');

    expect(sent()).toContainEqual([
      'mail:send',
      { to: 'Bo', itemId: 7, quantity: 2, message: 'enjoy' },
    ]);
    expect(screen.getByRole('img', { name: 'Item: empty' })).toBeTruthy();
    expect(screen.getByLabelText('Note (optional)')).toHaveProperty(
      'value',
      '',
    );
  });

  it('keeps a half-written letter through an update and a look at the inbox', () => {
    fireEvent.change(screen.getByPlaceholderText('Player name'), {
      target: { value: 'Ca' },
    });
    fireEvent.change(screen.getByLabelText('Note (optional)'), {
      target: { value: 'hel' },
    });
    emit('mail:update', { letters: LETTERS });
    tab('Inbox');
    tab('Send');
    expect(screen.getByPlaceholderText('Player name')).toHaveProperty(
      'value',
      'Ca',
    );
    expect(screen.getByLabelText('Note (optional)')).toHaveProperty(
      'value',
      'hel',
    );
  });
});
