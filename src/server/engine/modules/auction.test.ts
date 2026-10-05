// Exercises the real auction module: the buyer pays with exchangeItems
// and the seller is paid through the delivery queue. Asserted hardest is
// where the two do not meet: a listing never mints an item, and a reserved
// listing is never sold twice.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { unloadAllModules } from './moduleLoader.js';
import { loadModulesForTest } from '../../../test/modules.js';
import { clearProvides, useApi } from './registry.js';
import { clearCommands } from '../commands.js';
import { clearAll, emit } from '../hooks.js';
import { drainGameEvents } from '../eventBus.js';
import { createFixture } from '../../sim/simFixture.js';
import { msToTicks } from '../../sim/clock.js';
import { kvDelete, kvKeys } from '../../persistence/kvStore.js';
import * as deliveryService from '../../services/economy/deliveryService.js';
import type { PlayerServer } from '../../../shared/types.js';

let sim: ReturnType<typeof createFixture>;
let queued: { to: string; itemId: number; quantity?: number }[];

const COIN = 3;
const SWORD = 1;

beforeEach(() => {
  clearAll();
  clearCommands();
  clearProvides();
  drainGameEvents();
  for (const key of kvKeys('auction')) kvDelete('auction', key);

  queued = [];
  vi.spyOn(deliveryService, 'queueDelivery').mockImplementation(
    (input: { to: string; itemId: number; quantity?: number }) => {
      queued.push(input);
      return Promise.resolve({ ok: true, id: `d${queued.length}` });
    },
  );

  sim = createFixture(0);
  sim.addItem({ id: COIN, name: 'Gold', type: 'misc' } as never);
  sim.addItem({ id: SWORD, name: 'Sword', type: 'weapon' } as never);
  loadModulesForTest('auction');
});

afterEach(() => {
  unloadAllModules();
  clearAll();
  clearProvides();
  vi.restoreAllMocks();
});

const auction = () =>
  useApi<{
    listings: () => {
      id: string;
      seller: string;
      item: string;
      quantity: number;
      price: number;
    }[];
    list: (
      p: PlayerServer,
      itemId: number,
      quantity: number,
      price: number,
    ) => string;
    buy: (p: PlayerServer, id: string) => Promise<string>;
    cancel: (p: PlayerServer, id: string) => Promise<string>;
  }>('auction')!;

// An inventory row names the item as `item`, not `itemId` (shared/types.ts).
function playerWith(name: string, items: { item: number; quantity: number }[]) {
  const player = sim.addPlayer({ name });
  player.inventory.items = items.map((entry) => ({ ...entry }));
  return player;
}

const countOf = (player: PlayerServer, itemId: number) =>
  player.inventory.items
    .filter((entry) => entry.item === itemId)
    .reduce((sum, entry) => sum + entry.quantity, 0);

describe('listing', () => {
  it('takes the item out of the seller bag and holds it', () => {
    const seller = playerWith('Ana', [{ item: SWORD, quantity: 2 }]);

    auction().list(seller, SWORD, 2, 50);

    expect(countOf(seller, SWORD)).toBe(0);
    expect(auction().listings()).toMatchObject([
      { seller: 'Ana', item: 'Sword', quantity: 2, price: 50 },
    ]);
  });

  it('refuses more than the seller has, and takes nothing', () => {
    const seller = playerWith('Ana', [{ item: SWORD, quantity: 1 }]);

    const reply = auction().list(seller, SWORD, 5, 50);

    expect(reply).toBe('You do not have that many.');
    expect(countOf(seller, SWORD)).toBe(1);
    expect(auction().listings()).toEqual([]);
  });

  it('refuses a price below one, so nothing is listed for free', () => {
    const seller = playerWith('Ana', [{ item: SWORD, quantity: 1 }]);

    expect(auction().list(seller, SWORD, 1, 0)).toBe(
      'The price has to be at least 1.',
    );
    expect(countOf(seller, SWORD)).toBe(1);
  });

  it('refuses an item that does not exist', () => {
    const seller = playerWith('Ana', [{ item: SWORD, quantity: 1 }]);

    expect(auction().list(seller, 999, 1, 10)).toBe('No such item.');
  });
});

describe('buying', () => {
  it('moves the coins and the item in the one exchange', async () => {
    const seller = playerWith('Ana', [{ item: SWORD, quantity: 1 }]);
    const buyer = playerWith('Bo', [{ item: COIN, quantity: 100 }]);
    auction().list(seller, SWORD, 1, 50);
    const [listing] = auction().listings();

    await auction().buy(buyer, listing!.id);

    expect(countOf(buyer, SWORD)).toBe(1);
    expect(countOf(buyer, COIN)).toBe(50);
    expect(auction().listings()).toEqual([]);
  });

  it('pays the seller through the queue, which reaches them offline', async () => {
    const seller = playerWith('Ana', [{ item: SWORD, quantity: 1 }]);
    const buyer = playerWith('Bo', [{ item: COIN, quantity: 100 }]);
    auction().list(seller, SWORD, 1, 50);
    const [listing] = auction().listings();

    await auction().buy(buyer, listing!.id);

    expect(queued).toMatchObject([{ to: 'Ana', itemId: COIN, quantity: 50 }]);
  });

  it('owes the seller a refused payment until the sweep delivers it', async () => {
    const seller = playerWith('Ana', [{ item: SWORD, quantity: 1 }]);
    const buyer = playerWith('Bo', [{ item: COIN, quantity: 100 }]);
    auction().list(seller, SWORD, 1, 50);
    const [listing] = auction().listings();
    vi.mocked(deliveryService.queueDelivery).mockResolvedValueOnce({
      ok: false,
      reason: 'mailbox-full',
    });

    await auction().buy(buyer, listing!.id);
    expect(queued).toEqual([]);
    expect(kvKeys('auction')).toHaveLength(1);

    sim.step(msToTicks(60_000));
    await vi.waitFor(() => expect(kvKeys('auction')).toEqual([]));
    expect(queued).toMatchObject([{ to: 'Ana', itemId: COIN, quantity: 50 }]);
  });

  it('refuses a buyer who cannot afford it, and leaves the listing up', async () => {
    const seller = playerWith('Ana', [{ item: SWORD, quantity: 1 }]);
    const buyer = playerWith('Bo', [{ item: COIN, quantity: 10 }]);
    auction().list(seller, SWORD, 1, 50);
    const [listing] = auction().listings();

    const reply = await auction().buy(buyer, listing!.id);

    expect(reply).toContain('You need 50');
    expect(auction().listings()).toHaveLength(1);
    expect(countOf(buyer, COIN)).toBe(10);
    expect(queued).toEqual([]);
  });

  it('refuses the seller buying their own listing', async () => {
    const seller = playerWith('Ana', [
      { item: SWORD, quantity: 1 },
      { item: COIN, quantity: 100 },
    ]);
    auction().list(seller, SWORD, 1, 50);
    const [listing] = auction().listings();

    expect(await auction().buy(seller, listing!.id)).toBe(
      'You cannot buy your own listing.',
    );
    expect(auction().listings()).toHaveLength(1);
  });

  it('cannot be sold twice, because the listing is reserved before the money moves', async () => {
    const seller = playerWith('Ana', [{ item: SWORD, quantity: 1 }]);
    const first = playerWith('Bo', [{ item: COIN, quantity: 100 }]);
    const second = playerWith('Cy', [{ item: COIN, quantity: 100 }]);
    auction().list(seller, SWORD, 1, 50);
    const [listing] = auction().listings();

    const [a, b] = await Promise.all([
      auction().buy(first, listing!.id),
      auction().buy(second, listing!.id),
    ]);

    const bought = [a, b].filter((reply) => reply.startsWith('Bought'));
    expect(bought).toHaveLength(1);
    expect(countOf(first, SWORD) + countOf(second, SWORD)).toBe(1);
  });

  it('puts the listing back when the buyer bag is full', async () => {
    const seller = playerWith('Ana', [{ item: SWORD, quantity: 1 }]);
    const buyer = playerWith('Bo', [{ item: COIN, quantity: 100 }]);
    buyer.inventory.maxCapacity = 1; // the coins already fill it
    auction().list(seller, SWORD, 1, 50);
    const [listing] = auction().listings();

    const reply = await auction().buy(buyer, listing!.id);

    expect(reply).toBe('Your bag is full.');
    expect(auction().listings()).toHaveLength(1);
    expect(countOf(buyer, COIN)).toBe(100);
  });
});

describe('cancelling', () => {
  it('returns the item through the queue, not straight to the bag', async () => {
    const seller = playerWith('Ana', [{ item: SWORD, quantity: 2 }]);
    auction().list(seller, SWORD, 2, 50);
    const [listing] = auction().listings();

    const reply = await auction().cancel(seller, listing!.id);

    expect(reply).toBe('Cancelled, and the item is in your mailbox.');
    expect(queued).toMatchObject([{ to: 'Ana', itemId: SWORD, quantity: 2 }]);
    expect(auction().listings()).toEqual([]);
  });

  it('keeps the listing when the mailbox has no room for the item', async () => {
    const seller = playerWith('Ana', [{ item: SWORD, quantity: 1 }]);
    auction().list(seller, SWORD, 1, 50);
    const [listing] = auction().listings();
    vi.mocked(deliveryService.queueDelivery).mockResolvedValueOnce({
      ok: false,
      reason: 'mailbox-full',
    });

    const reply = await auction().cancel(seller, listing!.id);

    expect(reply).toBe(
      'Your mailbox has no room for it, so the listing stays up.',
    );
    expect(auction().listings()).toHaveLength(1);
  });

  it('refuses somebody else listing', async () => {
    const seller = playerWith('Ana', [{ item: SWORD, quantity: 1 }]);
    const other = playerWith('Bo', []);
    auction().list(seller, SWORD, 1, 50);
    const [listing] = auction().listings();

    expect(await auction().cancel(other, listing!.id)).toBe(
      'That listing is not yours.',
    );
    expect(auction().listings()).toHaveLength(1);
  });
});

describe('what the client is sent', () => {
  it('carries the item names, so the client does not need the catalogue', () => {
    const seller = playerWith('Ana', [{ item: SWORD, quantity: 1 }]);
    const buyer = playerWith('Bo', []);
    auction().list(seller, SWORD, 1, 50);
    drainGameEvents();

    emit('customAction', {
      player: buyer,
      channel: 'auction:request',
      payload: null,
    });

    const update = drainGameEvents().find(
      (e) => e.type === 'customPlayer' && e.channel === 'auction:update',
    ) as
      | { payload: { listings: { item: string }[]; currency: string } }
      | undefined;
    expect(update?.payload.listings[0]?.item).toBe('Sword');
    expect(update?.payload.currency).toBe('Gold');
  });
});
