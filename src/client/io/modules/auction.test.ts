import { describe, it, expect, beforeEach } from 'vitest';
import { loadClientModule } from '../../../test/clientModule';

// The shipped modules/auction/client.js, loaded the way the browser loads it.

let mod: ReturnType<typeof loadClientModule>;

beforeEach(() => {
  mod = loadClientModule('auction');
});

const panel = () => mod.panels[0];
const update = (payload: unknown) =>
  mod.handlers.get('auction:update')!(payload);
const sent = () =>
  (
    mod.engine.sendServerEvent as unknown as {
      mock: { calls: [string, unknown?][] };
    }
  ).mock.calls;
const buttons = () => [...panel().body.querySelectorAll('button')];
const click = (label: string) => {
  const button = buttons().find((b) => b.textContent === label);
  if (!button) throw new Error(`no "${label}" button`);
  button.click();
};

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

describe('browsing', () => {
  it('asks the server for the listings on load', () => {
    expect(sent()).toContainEqual(['auction:request']);
  });

  it('says the house is empty rather than drawing a bare list', () => {
    expect(panel().body.textContent).toContain('Nothing is up for auction.');
  });

  it('shows the quantity, the item, the seller and the price', () => {
    update(STATE);

    expect(panel().body.textContent).toContain('2x Sword');
    expect(panel().body.textContent).toContain('by Bo');
    expect(panel().body.textContent).toContain('50 Gold');
  });

  it('offers Buy on somebody else listing and Cancel on its own', () => {
    update(STATE);

    expect(buttons().map((b) => b.textContent)).toEqual([
      'Browse',
      'Mine',
      'Sell',
      'Buy',
      'Cancel',
    ]);
  });

  it('sends the id of the listing bought', () => {
    update(STATE);

    click('Buy');

    expect(sent()).toContainEqual(['auction:buy', { id: 'a1' }]);
  });

  it('counts everything up for auction in the title', () => {
    update(STATE);

    expect(panel().title).toBe('Auction (2)');
  });
});

describe('the mine tab', () => {
  it('narrows to this player listings', () => {
    update(STATE);

    click('Mine');

    expect(panel().body.textContent).toContain('Shield');
    expect(panel().body.textContent).not.toContain('Sword');
  });

  it('cancels the one clicked', () => {
    update(STATE);
    click('Mine');

    click('Cancel');

    expect(sent()).toContainEqual(['auction:cancel', { id: 'a2' }]);
  });
});

describe('the sell tab', () => {
  beforeEach(() => {
    update(STATE);
    click('Sell');
  });

  it('offers what the player can actually sell, by name', () => {
    const options = [...panel().body.querySelectorAll('option')];
    expect(options.map((o) => o.textContent)).toEqual(['Potion (5)']);
    expect(options[0].value).toBe('7');
  });

  it('sends the item, quantity and price the form holds', () => {
    const [quantity, price] = [...panel().body.querySelectorAll('input')];
    quantity.value = '3';
    price.value = '250';

    click('List');

    expect(sent()).toContainEqual([
      'auction:list',
      { itemId: 7, quantity: 3, price: 250 },
    ]);
  });

  it('sends nothing for a price of zero, which the server would refuse', () => {
    const before = sent().length;

    click('List');

    expect(sent()).toHaveLength(before);
  });

  it('says what a fee leaves the seller with', () => {
    update({ ...STATE, feePercent: 10 });
    click('Sell');
    const price = [...panel().body.querySelectorAll('input')][1];

    price.value = '200';
    price.dispatchEvent(new Event('input'));

    expect(panel().body.textContent).toContain('Fee: 10%');
    expect(panel().body.textContent).toContain('You get 180');
  });

  it('says so when there is nothing to sell', () => {
    update({ ...STATE, inventory: [] });
    click('Sell');

    expect(panel().body.textContent).toContain('Nothing you can sell.');
  });
});

describe('a payload that is not there', () => {
  it('is ignored rather than drawn from', () => {
    update(STATE);
    expect(() => update(null)).not.toThrow();
    expect(panel().body.textContent).toContain('Sword');
  });
});
