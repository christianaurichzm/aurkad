import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  onTestFinished,
  vi,
} from 'vitest';
import mongoose from 'mongoose';
import { playerRepository } from '../../persistence/playerRepository.js';
import { unloadAllModules } from './moduleLoader.js';
import { loadModulesForTest } from '../../../test/modules.js';
import { useApi, clearProvides } from './registry.js';
import { handleChatCommand, clearCommands } from '../commands.js';
import { clearAll, emit } from '../hooks.js';
import { drainGameEvents } from '../eventBus.js';
import { handleCustomAction } from '../../services/comms/customEventService.js';
import { clearKvStoreMemory, kvGet } from '../../persistence/kvStore.js';
import { createFixture, tile } from '../../sim/simFixture.js';
import { awardExperience } from '../../services/player/playerService.js';
import { equipItem } from '../../services/economy/inventoryService.js';
import { resolveDamage } from '../../services/combat/index.js';
import type { PlayerServer } from '../../../shared/types.js';

interface PartyApi {
  members: (playerName: string) => string[];
}

interface EquipmentApi {
  defineSet: (set: {
    id: string;
    pieces: number[];
    effects: Array<{ attribute: string; type: string; value: number }>;
  }) => boolean;
  activeSets: (player: PlayerServer) => Array<{ id: string }>;
}

interface StatusApi {
  apply: (
    player: PlayerServer,
    id: string,
    overrides?: Record<string, unknown>,
  ) => boolean;
}

type BankState = {
  maxCapacity: number;
  items: Array<{ item: number; quantity: number }>;
};

beforeEach(() => {
  clearAll();
  clearCommands();
  clearProvides();
  clearKvStoreMemory();
  drainGameEvents();
  loadModulesForTest('party', 'equipment', 'status', 'bank');
});

afterEach(() => {
  unloadAllModules();
  clearAll();
  clearCommands();
  clearProvides();
  clearKvStoreMemory();
});

describe('gameplay modules', () => {
  it('party creates groups and shares nearby kill XP', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice', position: tile(1, 1) });
    const bob = sim.addPlayer({ name: 'Bob', position: tile(2, 1) });

    handleChatCommand(alice, '/party create');
    handleChatCommand(alice, '/party invite Bob');
    handleChatCommand(bob, '/party accept Alice');

    const party = useApi<PartyApi>('party');
    expect(party?.members('Alice')).toEqual(['Alice', 'Bob']);

    awardExperience(alice, 80, 'kill');

    expect(alice.experience).toBe(40);
    expect(bob.experience).toBe(40);
  });

  it('trade swaps offered items once the commit is saved', async () => {
    // Durability belongs to transactions.test.ts; here the write lands when
    // the test says so.
    const connected = vi
      .spyOn(mongoose.connection, 'readyState', 'get')
      .mockReturnValue(mongoose.ConnectionStates.connected);
    let land = () => {};
    const landed = new Promise<void>((resolve) => (land = resolve));
    const save = vi
      .spyOn(playerRepository, 'save')
      .mockImplementation(() => landed.then(() => true));
    onTestFinished(() => {
      connected.mockRestore();
      save.mockRestore();
    });
    const sim = createFixture(0);
    const alice = sim.addPlayer({
      name: 'Alice',
      inventory: { items: [{ item: 30, quantity: 3 }], maxCapacity: 10 },
    });
    const bob = sim.addPlayer({
      name: 'Bob',
      inventory: { items: [{ item: 40, quantity: 1 }], maxCapacity: 10 },
    });

    handleChatCommand(alice, '/trade offer Bob 30 2 40 1');
    handleChatCommand(bob, '/trade accept Alice');

    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    const held = (entry: { item: number }) => entry.item === 30;
    expect(alice.inventory.items.find(held)?.quantity).toBe(3);

    land();
    await vi.waitFor(() =>
      expect(alice.inventory.items.find(held)?.quantity).toBe(1),
    );
    expect(
      alice.inventory.items.find((entry) => entry.item === 40)?.quantity,
    ).toBe(1);
    expect(
      bob.inventory.items.find((entry) => entry.item === 30)?.quantity,
    ).toBe(2);
    expect(
      bob.inventory.items.find((entry) => entry.item === 40),
    ).toBeUndefined();
  });

  it('bank deposits and withdraws item stacks on the player document', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({
      name: 'Alice',
      inventory: { items: [{ item: 30, quantity: 5 }], maxCapacity: 10 },
    });

    handleChatCommand(alice, '/bank deposit 30 3');

    expect(
      alice.inventory.items.find((entry) => entry.item === 30)?.quantity,
    ).toBe(2);
    expect((alice.data?.['bank'] as BankState).items).toEqual([
      { item: 30, quantity: 3 },
    ]);
    expect(kvGet('bank', 'Alice')).toBeUndefined();

    handleChatCommand(alice, '/bank withdraw 30 2');

    expect(
      alice.inventory.items.find((entry) => entry.item === 30)?.quantity,
    ).toBe(4);
    expect((alice.data?.['bank'] as BankState).items).toEqual([
      { item: 30, quantity: 1 },
    ]);
  });

  // End to end for the module half of the translation: the table ships inside
  // the module, the sandbox hands it `i18n` and `t`, and the reply funnel is
  // what turns a handler's English into the language the session asked for.
  it('answers a module command in the language the session asked for', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });
    alice.language = 'pt';
    drainGameEvents();

    handleChatCommand(alice, '/bank list');

    expect(drainGameEvents()[0]).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({ message: 'Banco: vazio' }),
      }),
    );
  });

  // The window draws a stack from what the server says it is, and a refusal
  // has to reach the window that asked rather than the chat behind it.
  it('bank tells its window what each stack is, and why a move did not happen', () => {
    const sim = createFixture(0);
    const potion = {
      id: 30,
      name: 'Potion',
      description: '',
      sprite: 4,
      type: 'consumable' as const,
    };
    sim.addItem(potion);
    sim.addPlayer({
      name: 'Alice',
      inventory: { items: [{ item: 30, quantity: 5 }], maxCapacity: 10 },
    });
    const ask = (channel: string, payload?: unknown) => {
      drainGameEvents();
      handleCustomAction({
        type: 'custom',
        username: 'Alice',
        channel,
        payload,
      });
      return drainGameEvents().filter((e) => e.type === 'customPlayer') as {
        channel: string;
        payload: Record<string, unknown>;
      }[];
    };

    const stored = ask('bank:deposit', { itemId: 30, quantity: 3 });
    expect(stored.find((e) => e.channel === 'bank:update')?.payload).toEqual({
      maxCapacity: 50,
      items: [{ item: expect.objectContaining(potion), quantity: 3 }],
    });
    expect(stored.find((e) => e.channel === 'bank:result')?.payload).toEqual({
      message: 'Deposited.',
    });

    expect(ask('bank:withdraw', { itemId: 99, quantity: 1 })).toEqual([
      expect.objectContaining({
        channel: 'bank:result',
        payload: { message: 'That item is not in your bank.' },
      }),
    ]);
  });

  it('bank conserves the total item count across any deposit/withdraw sequence', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({
      name: 'Alice',
      inventory: { items: [{ item: 30, quantity: 10 }], maxCapacity: 10 },
    });
    const total = () => {
      const inv =
        alice.inventory.items.find((entry) => entry.item === 30)?.quantity ?? 0;
      const bank = (alice.data?.['bank'] as BankState | undefined)?.items.find(
        (entry) => entry.item === 30,
      )?.quantity;
      return inv + (bank ?? 0);
    };

    const ops = [
      '/bank deposit 30 3',
      '/bank withdraw 30 1',
      '/bank deposit 30 7',
      '/bank withdraw 30 9',
      '/bank deposit 30 2',
      '/bank withdraw 30 5',
    ];
    for (const op of ops) {
      handleChatCommand(alice, op);
      expect(total()).toBe(10);
    }
  });

  it('trade answers the window with whether it happened and why not', () => {
    const sim = createFixture(0);
    sim.addItem({
      id: 30,
      name: 'Potion',
      description: '',
      sprite: 7,
      type: 'consumable',
    });
    const alice = sim.addPlayer({
      name: 'Alice',
      inventory: { items: [{ item: 30, quantity: 3 }], maxCapacity: 10 },
    });
    sim.addPlayer({ name: 'Bob' });
    const offer = (to: string) => {
      drainGameEvents();
      emit('customAction', {
        player: alice,
        channel: 'trade:offer',
        payload: { to, giveItemId: 30, giveQty: 2 },
      });
      const sent = drainGameEvents().filter((e) => e.type === 'customPlayer');
      const of = (channel: string) =>
        sent.find((e) => e.channel === channel && e.username === 'Alice')
          ?.payload as Record<string, unknown> | undefined;
      return { result: of('trade:result'), update: of('trade:update') };
    };

    expect(offer('Nobody').result).toEqual({
      ok: false,
      message: 'Player not found.',
    });

    const { result, update } = offer('Bob');
    expect(result).toEqual({ ok: true, message: 'Trade offered to Bob.' });
    // The picture comes with the offer: the other side may not own the item.
    expect(update?.['offers']).toMatchObject([
      { from: 'Alice', to: 'Bob', give: { name: 'Potion', sprite: 7 } },
    ]);
  });

  it('trade lists what can be asked for, without what is bound', () => {
    const sim = createFixture(0);
    const base = { description: '', sprite: 2, type: 'weapon' as const };
    sim.addItem({ ...base, id: 70, name: 'Axe' });
    sim.addItem({ ...base, id: 71, name: 'Oath', bound: true });
    sim.addItem({ ...base, id: 72, name: 'Silver', type: 'money' });
    const alice = sim.addPlayer({ name: 'Alice' });
    drainGameEvents();

    emit('customAction', {
      player: alice,
      channel: 'trade:items',
      payload: null,
    });

    const items = (
      drainGameEvents().find(
        (e) => e.type === 'customPlayer' && e.channel === 'trade:items',
      ) as { payload: { items: { id: number; name: string }[] } } | undefined
    )?.payload.items;
    expect(items).toContainEqual({
      id: 70,
      name: 'Axe',
      sprite: 2,
      type: 'weapon',
      effects: [],
    });
    expect(items?.some((item) => item.id === 71)).toBe(false);
    // Money first, then by name.
    expect(items?.[0]?.id).toBe(72);
    const rest = items?.slice(1).map((item) => item.name) ?? [];
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)));
  });

  it('bound items cannot be traded or banked', () => {
    const sim = createFixture(0);
    sim.addItem({
      id: 50,
      name: 'Soul Blade',
      description: '',
      sprite: 0,
      type: 'weapon',
      bound: true,
    });
    const alice = sim.addPlayer({
      name: 'Alice',
      inventory: { items: [{ item: 50, quantity: 1 }], maxCapacity: 10 },
    });
    const bob = sim.addPlayer({ name: 'Bob' });

    handleChatCommand(alice, '/trade offer Bob 50 1');
    handleChatCommand(bob, '/trade accept Alice');

    expect(
      alice.inventory.items.find((entry) => entry.item === 50)?.quantity,
    ).toBe(1);
    expect(
      bob.inventory.items.find((entry) => entry.item === 50),
    ).toBeUndefined();

    handleChatCommand(alice, '/bank deposit 50 1');

    expect(
      alice.inventory.items.find((entry) => entry.item === 50)?.quantity,
    ).toBe(1);
    expect(alice.data?.['bank']).toBeUndefined();
  });

  it('an accepted trade is rejected if the item became bound after the offer', () => {
    const sim = createFixture(0);
    sim.addItem({
      id: 60,
      name: 'Blade',
      description: '',
      sprite: 0,
      type: 'weapon',
    });
    const alice = sim.addPlayer({
      name: 'Alice',
      inventory: { items: [{ item: 60, quantity: 1 }], maxCapacity: 10 },
    });
    const bob = sim.addPlayer({ name: 'Bob' });

    handleChatCommand(alice, '/trade offer Bob 60 1');
    sim.addItem({
      id: 60,
      name: 'Blade',
      description: '',
      sprite: 0,
      type: 'weapon',
      bound: true,
    });
    handleChatCommand(bob, '/trade accept Alice');

    expect(
      alice.inventory.items.find((entry) => entry.item === 60)?.quantity,
    ).toBe(1);
    expect(
      bob.inventory.items.find((entry) => entry.item === 60),
    ).toBeUndefined();
  });

  it('equipment applies and removes configured set bonuses', () => {
    const equipment = useApi<EquipmentApi>('equipment');
    expect(
      equipment?.defineSet({
        id: 'scout',
        pieces: [101, 102],
        effects: [{ attribute: 'attack', type: 'add', value: 7 }],
      }),
    ).toBe(true);

    const sim = createFixture(0);
    sim.addItem({
      id: 101,
      name: 'Scout Helm',
      description: '',
      sprite: 0,
      type: 'helmet',
    });
    sim.addItem({
      id: 102,
      name: 'Scout Boots',
      description: '',
      sprite: 0,
      type: 'boots',
    });
    const alice = sim.addPlayer({
      name: 'Alice',
      attack: 10,
      inventory: {
        items: [
          { item: 101, quantity: 1 },
          { item: 102, quantity: 1 },
        ],
        maxCapacity: 10,
      },
    });

    equipItem(alice, 101);
    equipItem(alice, 102);

    // No tick in between: the module follows itemEquip/itemUnequip, so the
    // bonus lands on the transition rather than on the next sweep.
    expect(alice.attack).toBe(17);
    expect(equipment?.activeSets(alice).map((set) => set.id)).toEqual([
      'scout',
    ]);

    equipItem(alice, 102);

    expect(alice.attack).toBe(10);
    expect(equipment?.activeSets(alice)).toEqual([]);
  });

  it('status effects modify damage and tick healing', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });
    const bob = sim.addPlayer({ name: 'Bob', health: 100, maxHealth: 100 });
    const status = useApi<StatusApi>('status');

    expect(status?.apply(alice, 'fury', { durationTicks: 40 })).toBe(true);
    expect(status?.apply(bob, 'shield', { durationTicks: 40 })).toBe(true);

    resolveDamage(bob, 20, { attacker: alice, map: sim.map });

    expect(bob.health).toBe(85);

    bob.health = 80;
    expect(
      status?.apply(bob, 'regen', {
        durationTicks: 40,
        tickInterval: 20,
        healPerTick: 5,
      }),
    ).toBe(true);

    sim.step(20);

    expect(bob.health).toBe(85);
  });
});
