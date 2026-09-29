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

beforeEach(() => {
  document.body.innerHTML = '';
  listening = vi.spyOn(window, 'addEventListener');
  mod = loadClientModule('trade');
});

afterEach(() => {
  for (const [type, listener] of listening.mock.calls)
    if (type === 'inventory:item-for-trade')
      window.removeEventListener(type, listener);
  listening.mockRestore();
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

const OFFERS = {
  player: 'Ana',
  offers: [
    {
      from: 'Bo',
      to: 'Ana',
      give: { itemId: 3, name: 'Sword', quantity: 1 },
      want: { itemId: 9, name: 'Gem', quantity: 2 },
    },
    {
      from: 'Ana',
      to: 'Cy',
      give: { itemId: 5, quantity: 4 },
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

  it('lists the offers to answer and the ones sent', () => {
    emit('trade:update', OFFERS);
    openWindow();

    const incoming = screen.getByRole('list', { name: 'Incoming offers' });
    expect(incoming.textContent).toContain('Bo: Sword×1 for Gem×2');
    fireEvent.click(within(incoming).getByRole('button', { name: 'Accept' }));
    expect(sent()).toContainEqual(['trade:accept', { from: 'Bo' }]);
    fireEvent.click(within(incoming).getByRole('button', { name: 'Decline' }));
    expect(sent()).toContainEqual(['trade:cancel', { player: 'Bo' }]);

    const outgoing = screen.getByRole('list', { name: 'Your offers' });
    expect(outgoing.textContent).toContain('→ Cy: #5×4 (gift)');
    fireEvent.click(within(outgoing).getByRole('button', { name: 'Cancel' }));
    expect(sent()).toContainEqual(['trade:cancel', { player: 'Cy' }]);
  });

  it('says so when there is nothing to answer', () => {
    emit('trade:update', { player: 'Ana', offers: [] });
    openWindow();
    expect(screen.getByText('No active trades.')).toBeTruthy();
  });
});

describe('the offer form', () => {
  const type = (placeholder: string, value: string, at = 0) =>
    fireEvent.change(screen.getAllByPlaceholderText(placeholder)[at], {
      target: { value },
    });
  const submit = () =>
    fireEvent.click(screen.getByRole('button', { name: 'Send Offer' }));

  it('sends a gift, and a swap with what is wanted back', () => {
    openWindow();
    type('Player name', ' Bo ');
    type('Give item ID', '3');
    type('Qty', '2');
    submit();
    expect(sent()).toContainEqual([
      'trade:offer',
      {
        to: 'Bo',
        giveItemId: 3,
        giveQty: 2,
        wantItemId: undefined,
        wantQty: undefined,
      },
    ]);

    type('Want item ID (opt)', '9');
    type('Qty', '0', 1);
    submit();
    expect(sent()).toContainEqual([
      'trade:offer',
      { to: 'Bo', giveItemId: 3, giveQty: 2, wantItemId: 9, wantQty: 1 },
    ]);
  });

  it('sends nothing without a player and an item to give', () => {
    openWindow();
    type('Give item ID', '3');
    submit();
    type('Player name', 'Bo');
    type('Give item ID', '');
    submit();
    expect(sent().some(([channel]) => channel === 'trade:offer')).toBe(false);
  });

  it('keeps what was typed through an update from the server', () => {
    openWindow();
    type('Player name', 'Bo');
    type('Give item ID', '3');

    emit('trade:update', OFFERS);

    expect(screen.getByPlaceholderText('Player name')).toHaveProperty(
      'value',
      'Bo',
    );
    expect(screen.getByPlaceholderText('Give item ID')).toHaveProperty(
      'value',
      '3',
    );
  });

  it('takes the item clicked in the inventory', () => {
    openWindow();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('inventory:item-for-trade', {
          detail: { itemId: 12, quantity: 5 },
        }),
      );
    });
    expect(screen.getByPlaceholderText('Give item ID')).toHaveProperty(
      'value',
      '12',
    );
    expect(screen.getAllByPlaceholderText('Qty')[0]).toHaveProperty(
      'value',
      '1',
    );
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
    expect(screen.getByPlaceholderText('Player name')).toHaveProperty(
      'value',
      'Bo',
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
