import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type MockInstance,
} from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { loadClientModule } from '../../../test/clientModule';

// The shipped modules/trade/client.jsx, compiled and loaded the way the
// browser gets it.

let mod: ReturnType<typeof loadClientModule>;

// The module listens on window for the inventory, which outlives the test that
// loaded it; a listener left behind would draw into an unmounted root.
let listening: MockInstance<typeof window.addEventListener>;

const potion = { id: 5, name: 'Potion', sprite: 1, type: 'consumable' };
const gem = { id: 9, name: 'Gem', sprite: 2, type: 'money' };
const relic = { id: 7, name: 'Relic', sprite: 3, type: 'weapon', bound: true };

let bag: { item: typeof potion; quantity: number }[];

beforeEach(() => {
  document.body.innerHTML = '';
  // An item's picture is drawn on a canvas, which jsdom does not have.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  listening = vi.spyOn(window, 'addEventListener');
  bag = [
    { item: potion, quantity: 4 },
    { item: relic, quantity: 1 },
  ];
  mod = loadClientModule('trade', {
    getPlayer: () => ({ name: 'Ana', inventory: bag }),
    getGameState: () => ({
      players: { a: { name: 'Ana' }, b: { name: 'Bo' }, c: { name: 'Cy' } },
    }),
  });
});

afterEach(() => {
  for (const [type, listener] of listening.mock.calls)
    if (type === 'inventory:item-for-trade')
      window.removeEventListener(type, listener);
  vi.restoreAllMocks();
});

const emit = (channel: string, payload: unknown) =>
  act(() => mod.handlers.get(channel)!(payload));
const sent = () =>
  (
    mod.engine.sendServerEvent as unknown as {
      mock: { calls: [string, unknown?][] };
    }
  ).mock.calls;
const openWindow = () => act(() => mod.actions.get('Trade')!.click());
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const click = (name: string | RegExp) => fireEvent.click(button(name));

const OFFERS = {
  player: 'Ana',
  offers: [
    {
      id: 11,
      from: 'Bo',
      to: 'Ana',
      give: { itemId: 3, name: 'Sword', sprite: 4, quantity: 1 },
      want: { itemId: 5, name: 'Potion', sprite: 1, quantity: 2 },
    },
    {
      from: 'Ana',
      to: 'Cy',
      give: { itemId: 5, name: 'Potion', sprite: 1, quantity: 4 },
    },
  ],
};

describe('trade window', () => {
  it('opens from the Actions menu, asks for the offers and closes on Escape', () => {
    const events: string[] = [];
    for (const type of ['trade:active', 'trade:inactive'])
      window.addEventListener(type, () => events.push(type), { once: true });

    openWindow();

    expect(screen.getByRole('dialog', { name: 'Trade' })).toBeTruthy();
    expect(
      sent().filter(([channel]) => channel === 'trade:request'),
    ).toHaveLength(2);
    expect(events).toEqual(['trade:active']);

    // Closed any way at all, the inventory leaves its trade mode too.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(events).toEqual(['trade:active', 'trade:inactive']);
  });

  it('lists the offers to answer and the ones sent, saying who gives what', () => {
    emit('trade:update', OFFERS);
    openWindow();

    const incoming = screen.getByRole('list', { name: 'Incoming' });
    expect(incoming.textContent).toContain('Bo gives');
    expect(
      within(incoming).getByRole('img', { name: 'Sword x1' }),
    ).toBeTruthy();
    expect(
      within(incoming).getByRole('img', { name: 'Potion x2' }),
    ).toBeTruthy();
    fireEvent.click(within(incoming).getByRole('button', { name: 'Accept' }));
    expect(sent()).toContainEqual(['trade:accept', { from: 'Bo', id: 11 }]);
    fireEvent.click(within(incoming).getByRole('button', { name: 'Decline' }));
    expect(sent()).toContainEqual(['trade:cancel', { player: 'Bo' }]);

    const outgoing = screen.getByRole('list', { name: 'Your offers' });
    expect(outgoing.textContent).toContain('You give Cy');
    expect(outgoing.textContent).toContain('as a gift');
    fireEvent.click(within(outgoing).getByRole('button', { name: 'Cancel' }));
    expect(sent()).toContainEqual(['trade:cancel', { player: 'Cy' }]);
  });

  it('will not accept an offer asking for more than the bag holds', () => {
    bag = [{ item: potion, quantity: 1 }];
    emit('trade:update', OFFERS);
    openWindow();

    expect(button('Not enough')).toHaveProperty('disabled', true);
  });

  it('says so when there is nothing to answer', () => {
    emit('trade:update', { player: 'Ana', offers: [] });
    openWindow();
    expect(screen.getByText('No offers yet.')).toBeTruthy();
  });
});

describe('a new offer', () => {
  it('is a gift from the bag to a player nearby', () => {
    openWindow();
    expect(button('Pick a player')).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByRole('radio', { name: /Bo/ }));
    expect(button('Pick an item to give')).toHaveProperty('disabled', true);

    // What is bound never changes hands, so it is not there to pick.
    expect(screen.queryByRole('button', { name: /Relic/ })).toBeNull();
    click('Potion, 4, 4 in bag');
    click('One more');
    click('Send as gift to Bo');

    expect(sent()).toContainEqual([
      'trade:offer',
      {
        to: 'Bo',
        giveItemId: 5,
        giveQty: 2,
        wantItemId: undefined,
        wantQty: undefined,
      },
    ]);
  });

  it('asks the server what can be wanted, once, and sends a swap', () => {
    openWindow();
    fireEvent.change(screen.getByRole('textbox', { name: 'Player name' }), {
      target: { value: ' Dee ' },
    });
    click('Potion, 4, 4 in bag');

    // Picking what to give moves on to what to ask for.
    expect(
      screen.getByRole('complementary', { name: 'All items' }),
    ).toBeTruthy();
    expect(
      sent().filter(([channel]) => channel === 'trade:items'),
    ).toHaveLength(1);
    emit('trade:items', { items: [potion, gem] });
    click('Gem');
    click('You give: Potion x1');
    click('You want (optional): Gem x1');

    expect(
      sent().filter(([channel]) => channel === 'trade:items'),
    ).toHaveLength(1);
    click('Send offer to Dee');
    expect(sent()).toContainEqual([
      'trade:offer',
      { to: 'Dee', giveItemId: 5, giveQty: 1, wantItemId: 9, wantQty: 1 },
    ]);
  });

  it('is cleared by a yes from the server and kept, with the reason, by a no', () => {
    openWindow();
    fireEvent.click(screen.getByRole('radio', { name: /Bo/ }));
    click('Potion, 4, 4 in bag');
    click('Send as gift to Bo');

    emit('trade:result', { ok: false, message: "Bo's inventory is full." });
    expect(screen.getByRole('alert').textContent).toBe(
      "Bo's inventory is full.",
    );
    click('Send as gift to Bo');

    emit('trade:result', { ok: true, message: 'Trade offered to Bo.' });
    expect(screen.getByRole('status').textContent).toBe('Trade offered to Bo.');
    expect(button('Pick an item to give')).toBeTruthy();
  });

  it('keeps what was picked through an update from the server', () => {
    openWindow();
    fireEvent.click(screen.getByRole('radio', { name: /Bo/ }));
    click('Potion, 4, 4 in bag');

    emit('trade:update', OFFERS);

    expect(button('Send as gift to Bo')).toBeTruthy();
  });

  it('takes the item offered from the inventory', () => {
    openWindow();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('inventory:item-for-trade', {
          detail: { itemId: 5, quantity: 4 },
        }),
      );
    });
    expect(button('You give: Potion x1')).toBeTruthy();
  });

  it('opens with the player chosen on the canvas filled in', () => {
    const [, tradeWith] = (
      mod.engine.registerPlayerAction as {
        mock: { calls: [string, (name: string) => void][] };
      }
    ).mock.calls.find(([label]) => label === 'Trade')!;
    const activated = vi.fn();
    window.addEventListener('trade:active', activated, { once: true });

    act(() => tradeWith('Bo'));

    expect(screen.getByRole('dialog', { name: 'Trade' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Bo/ })).toHaveProperty(
      'ariaChecked',
      'true',
    );
    expect(activated).toHaveBeenCalled();
  });
});

describe('a completed trade', () => {
  it('says so in the chat and in a notice, and asks for the offers again', () => {
    emit('trade:update', OFFERS);
    (mod.engine.sendServerEvent as ReturnType<typeof vi.fn>).mockClear();

    emit('trade:complete', OFFERS.offers[0]);

    expect(mod.engine.chat).toHaveBeenCalledWith('Trade with Bo completed.');
    expect(mod.container.textContent).toContain('Trade complete with Bo!');
    expect(sent()).toContainEqual(['trade:request']);
  });
});
