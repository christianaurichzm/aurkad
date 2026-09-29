import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { loadClientModule } from '../../../test/clientModule';

// The shipped modules/auction/client.jsx, compiled and loaded the way the
// browser gets it.

let mod: ReturnType<typeof loadClientModule>;

beforeEach(() => {
  document.body.innerHTML = '';
  mod = loadClientModule('auction');
});

const update = (payload: unknown) =>
  act(() => mod.handlers.get('auction:update')!(payload));
const sent = () =>
  (
    mod.engine.sendServerEvent as unknown as {
      mock: { calls: [string, unknown?][] };
    }
  ).mock.calls;
const openWindow = () => act(() => mod.actions.get('Auction')!.click());
const tab = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name }));
const field = (placeholder: string) =>
  screen.getByPlaceholderText<HTMLInputElement>(placeholder);
const type = (placeholder: string, value: string) =>
  fireEvent.change(field(placeholder), { target: { value } });
const text = () => screen.getByRole('dialog').textContent;

const STATE = {
  listings: [
    {
      id: 'a1',
      seller: 'Bo',
      itemId: 1,
      item: 'Sword',
      quantity: 2,
      price: 50,
    },
    {
      id: 'a2',
      seller: 'Ana',
      itemId: 4,
      item: 'Shield',
      quantity: 1,
      price: 90,
    },
  ],
  mine: ['a2'],
  inventory: [{ itemId: 7, item: 'Potion', quantity: 5 }],
  currency: 'Gold',
  feePercent: 0,
};

describe('the window', () => {
  it('asks the server for the listings on load', () => {
    expect(sent()).toContainEqual(['auction:request']);
  });

  it('opens from the Actions menu, asking again, and closes on Escape', () => {
    const before = sent().length;
    openWindow();
    expect(screen.getByRole('dialog', { name: 'Auction (0)' })).toBeTruthy();
    expect(sent().slice(before)).toEqual([['auction:request']]);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sent()).toHaveLength(before + 1);
  });
});

describe('browsing', () => {
  beforeEach(openWindow);

  it('says the house is empty rather than drawing a bare list', () => {
    expect(text()).toContain('Nothing is up for auction.');
  });

  it('shows the quantity, the item, the seller and the price', () => {
    update(STATE);

    expect(text()).toContain('2x Sword');
    expect(text()).toContain('by Bo');
    expect(text()).toContain('50 Gold');
  });

  it('offers Buy on somebody else listing and Cancel on its own', () => {
    update(STATE);

    const [sword, shield] = screen.getAllByRole('listitem');
    expect(
      within(sword)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Buy']);
    expect(
      within(shield)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Cancel']);
  });

  it('sends the id of the listing bought', () => {
    update(STATE);

    fireEvent.click(screen.getByRole('button', { name: 'Buy' }));

    expect(sent()).toContainEqual(['auction:buy', { id: 'a1' }]);
  });

  it('counts everything up for auction in the title', () => {
    update(STATE);

    expect(screen.getByRole('dialog', { name: 'Auction (2)' })).toBeTruthy();
  });
});

describe('the mine tab', () => {
  beforeEach(() => {
    openWindow();
    update(STATE);
    tab('Mine');
  });

  it('is the one marked as showing', () => {
    expect(
      screen.getByRole('button', { name: 'Mine', pressed: true }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Browse', pressed: false }),
    ).toBeTruthy();
  });

  it('narrows to this player listings', () => {
    expect(text()).toContain('Shield');
    expect(text()).not.toContain('Sword');
  });

  it('cancels the one clicked', () => {
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(sent()).toContainEqual(['auction:cancel', { id: 'a2' }]);
  });

  it('says so when there is nothing up', () => {
    update({ ...STATE, mine: [] });

    expect(text()).toContain('You have nothing up.');
  });

  it('is still the tab when the window is opened again', () => {
    fireEvent.keyDown(window, { key: 'Escape' });
    openWindow();

    expect(
      screen.getByRole('button', { name: 'Mine', pressed: true }),
    ).toBeTruthy();
  });
});

describe('the sell tab', () => {
  beforeEach(() => {
    openWindow();
    update(STATE);
    tab('Sell');
  });

  it('offers what the player can actually sell, by name', () => {
    const options = within(
      screen.getByRole('combobox', { name: 'Item' }),
    ).getAllByRole<HTMLOptionElement>('option');
    expect(options.map((o) => o.textContent)).toEqual(['Potion (5)']);
    expect(options[0].value).toBe('7');
  });

  it('sends the item, quantity and price the form holds', () => {
    type('Quantity', '3');
    type('Price', '250');

    fireEvent.click(screen.getByRole('button', { name: 'List' }));

    expect(sent()).toContainEqual([
      'auction:list',
      { itemId: 7, quantity: 3, price: 250 },
    ]);
    expect(field('Price').value).toBe('');
  });

  it('sends nothing for a price of zero, which the server would refuse', () => {
    const before = sent().length;
    const list = screen.getByRole('button', { name: 'List' });
    expect(list).toHaveProperty('disabled', true);

    fireEvent.click(list);

    expect(sent()).toHaveLength(before);
  });

  it('says what a fee leaves the seller with', () => {
    update({ ...STATE, feePercent: 10 });

    type('Price', '200');

    expect(text()).toContain('Fee: 10% - You get 180');
  });

  it('says so when there is nothing to sell', () => {
    update({ ...STATE, inventory: [] });

    expect(text()).toContain('Nothing you can sell.');
  });

  it('keeps a half-filled form through a server update and a tab switch', () => {
    type('Quantity', '3');
    type('Price', '25');

    update({ ...STATE, feePercent: 5 });
    expect(field('Quantity').value).toBe('3');
    expect(field('Price').value).toBe('25');

    tab('Browse');
    tab('Sell');
    expect(field('Quantity').value).toBe('3');
    expect(field('Price').value).toBe('25');
  });

  it('sends the first item once the one picked is no longer held', () => {
    update({
      ...STATE,
      inventory: [
        { itemId: 2, item: 'Herb', quantity: 1 },
        { itemId: 7, item: 'Potion', quantity: 5 },
      ],
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Item' }), {
      target: { value: '7' },
    });
    update({
      ...STATE,
      inventory: [{ itemId: 2, item: 'Herb', quantity: 1 }],
    });
    type('Price', '10');

    fireEvent.click(screen.getByRole('button', { name: 'List' }));

    expect(sent()).toContainEqual([
      'auction:list',
      { itemId: 2, quantity: 1, price: 10 },
    ]);
  });
});

describe('a payload that is not there', () => {
  it('is ignored rather than drawn from', () => {
    openWindow();
    update(STATE);
    expect(() => update(null)).not.toThrow();
    expect(text()).toContain('Sword');
  });
});
