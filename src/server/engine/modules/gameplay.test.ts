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
import { config } from '../../config.js';
import { playerRepository } from '../../persistence/playerRepository.js';
import { unloadAllModules } from './moduleLoader.js';
import { loadModulesForTest } from '../../../test/modules.js';
import { useApi, clearProvides } from './registry.js';
import { handleChatCommand, clearCommands } from '../commands.js';
import { clearAll, emit, on } from '../hooks.js';
import { drainGameEvents } from '../eventBus.js';
import { handleCustomAction } from '../../services/comms/customEventService.js';
import { clearKvStoreMemory, kvGet } from '../../persistence/kvStore.js';
import { createFixture, tile } from '../../sim/simFixture.js';
import { awardExperience } from '../../services/player/playerService.js';
import { equipItem } from '../../services/economy/inventoryService.js';
import { resolveDamage } from '../../services/combat/index.js';
import { teleportPlayer } from '../../services/world/movementService.js';
import { rebuildQuadtree } from '../../sim/spatialManager.js';
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

// Player data refuses every write from here to the end of the test, as it
// does for a player at the size limit.
function refusePlayerData() {
  const limits = config.scriptData as { maxValueBytes: number };
  const was = limits.maxValueBytes;
  limits.maxValueBytes = 10;
  onTestFinished(() => {
    limits.maxValueBytes = was;
  });
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

describe('knockback', () => {
  const hit = (attacker: PlayerServer, target: PlayerServer) =>
    emit('afterDamage', { attacker, target, damage: 1, lethal: false });

  it('pushes the target a tile away, and never onto someone else', () => {
    unloadAllModules();
    loadModulesForTest('knockback');
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice', position: tile(1, 1) });
    const bob = sim.addPlayer({ name: 'Bob', position: tile(2, 1) });
    const carol = sim.addPlayer({ name: 'Carol', position: tile(3, 1) });
    rebuildQuadtree(sim.mapId, sim.map);

    hit(alice, bob);
    expect(bob.position).toEqual(tile(2, 1));

    carol.position = tile(3, 5);
    rebuildQuadtree(sim.mapId, sim.map);
    hit(alice, bob);
    expect(bob.position).toEqual(tile(3, 1));
  });
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

  // A multiplier registered before the party's handler has already scaled the
  // killer's amount; splitting that hands every other member the multiplier
  // twice, once in the split and again on their own award.
  it('party applies an earlier multiplier to each share once', () => {
    unloadAllModules();
    on('beforeXpGain', (ctx) => {
      ctx.amount *= 2;
    });
    loadModulesForTest('party');
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice', position: tile(1, 1) });
    const bob = sim.addPlayer({ name: 'Bob', position: tile(2, 1) });
    handleChatCommand(alice, '/party create');
    handleChatCommand(alice, '/party invite Bob');
    handleChatCommand(bob, '/party accept Alice');

    awardExperience(alice, 80, 'kill');

    expect(alice.experience).toBe(80);
    expect(bob.experience).toBe(80);
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

  it('trade swaps between two full bags', async () => {
    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(
      mongoose.ConnectionStates.connected,
    );
    vi.spyOn(playerRepository, 'save').mockResolvedValue(true);
    onTestFinished(() => void vi.restoreAllMocks());
    const sim = createFixture(0);
    const alice = sim.addPlayer({
      name: 'Alice',
      inventory: { items: [{ item: 30, quantity: 1 }], maxCapacity: 1 },
    });
    const bob = sim.addPlayer({
      name: 'Bob',
      inventory: { items: [{ item: 40, quantity: 1 }], maxCapacity: 1 },
    });

    handleChatCommand(alice, '/trade offer Bob 30 1 40 1');
    handleChatCommand(bob, '/trade accept Alice');

    await vi.waitFor(() =>
      expect(alice.inventory.items).toEqual([{ item: 40, quantity: 1 }]),
    );
    expect(bob.inventory.items).toEqual([{ item: 30, quantity: 1 }]);
  });

  it('trade refuses an accept once the two are on different maps', async () => {
    const connected = vi
      .spyOn(mongoose.connection, 'readyState', 'get')
      .mockReturnValue(mongoose.ConnectionStates.connected);
    const save = vi.spyOn(playerRepository, 'save').mockResolvedValue(true);
    onTestFinished(() => {
      connected.mockRestore();
      save.mockRestore();
    });
    const sim = createFixture(0);
    sim.addMap({ id: 'cave' });
    const alice = sim.addPlayer({
      name: 'Alice',
      inventory: { items: [{ item: 30, quantity: 1 }], maxCapacity: 10 },
    });
    const bob = sim.addPlayer({ name: 'Bob' });
    handleChatCommand(alice, '/trade offer Bob 30 1');

    teleportPlayer(bob, 'cave', tile(1, 1));
    handleChatCommand(bob, '/trade accept Alice');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(save).not.toHaveBeenCalled();
    expect(alice.inventory.items).toEqual([{ item: 30, quantity: 1 }]);
    expect(bob.inventory.items).toEqual([]);
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

  it('trade accepts the offer the window showed, not one swapped in after it', async () => {
    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(
      mongoose.ConnectionStates.connected,
    );
    const save = vi.spyOn(playerRepository, 'save').mockResolvedValue(true);
    onTestFinished(() => void vi.restoreAllMocks());
    const sim = createFixture(0);
    const alice = sim.addPlayer({
      name: 'Alice',
      inventory: { items: [{ item: 30, quantity: 100 }], maxCapacity: 10 },
    });
    const bob = sim.addPlayer({
      name: 'Bob',
      inventory: { items: [{ item: 40, quantity: 1 }], maxCapacity: 10 },
    });
    const shown = () => {
      const update = drainGameEvents().findLast(
        (e) =>
          e.type === 'customPlayer' &&
          e.channel === 'trade:update' &&
          e.username === 'Bob',
      ) as { payload: { offers: Array<{ id: number }> } } | undefined;
      return update!.payload.offers[0]!;
    };

    drainGameEvents();
    handleChatCommand(alice, '/trade offer Bob 30 100 40 1');
    const seen = shown();
    handleChatCommand(alice, '/trade offer Bob 30 1 40 1');
    emit('customAction', {
      player: bob,
      channel: 'trade:accept',
      payload: { from: 'Alice', id: seen.id },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(save).not.toHaveBeenCalled();
    expect(bob.inventory.items).toEqual([{ item: 40, quantity: 1 }]);
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

  it('an accepted trade is rejected if the item became bound after the offer', async () => {
    const connected = vi
      .spyOn(mongoose.connection, 'readyState', 'get')
      .mockReturnValue(mongoose.ConnectionStates.connected);
    const save = vi.spyOn(playerRepository, 'save').mockResolvedValue(true);
    onTestFinished(() => {
      connected.mockRestore();
      save.mockRestore();
    });
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
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(save).not.toHaveBeenCalled();
    expect(
      alice.inventory.items.find((entry) => entry.item === 60)?.quantity,
    ).toBe(1);
    expect(
      bob.inventory.items.find((entry) => entry.item === 60),
    ).toBeUndefined();
  });

  it('bank leaves the bag as it was when the bank cannot be stored', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({
      name: 'Alice',
      inventory: { items: [{ item: 30, quantity: 5 }], maxCapacity: 10 },
    });
    handleChatCommand(alice, '/bank deposit 30 2');
    refusePlayerData();

    handleChatCommand(alice, '/bank deposit 30 3');
    handleChatCommand(alice, '/bank withdraw 30 2');

    expect(alice.inventory.items).toEqual([{ item: 30, quantity: 3 }]);
    expect((alice.data?.['bank'] as BankState).items).toEqual([
      { item: 30, quantity: 2 },
    ]);
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

  it('equipment takes a set off to the stat it found', () => {
    useApi<EquipmentApi>('equipment')?.defineSet({
      id: 'scout',
      pieces: [101],
      effects: [
        { attribute: 'attack', type: 'add', value: 2 },
        { attribute: 'attack', type: 'multiply', value: 2 },
      ],
    });
    const sim = createFixture(0);
    sim.addItem({
      id: 101,
      name: 'Helm',
      description: '',
      sprite: 0,
      type: 'helmet',
    });
    const alice = sim.addPlayer({
      name: 'Alice',
      attack: 10,
      inventory: { items: [{ item: 101, quantity: 1 }], maxCapacity: 10 },
    });

    for (let i = 0; i < 3; i++) {
      equipItem(alice, 101);
      expect(alice.attack).toBe(24);
      equipItem(alice, 101);
      expect(alice.attack).toBe(10);
    }
  });

  // What is stored is what the next reconcile takes off, so a bonus applied
  // under a refused write went on again at every equip.
  it('equipment applies no set bonus it could not record', () => {
    useApi<EquipmentApi>('equipment')?.defineSet({
      id: 'scout',
      pieces: [101, 102],
      effects: [{ attribute: 'attack', type: 'add', value: 7 }],
    });
    const sim = createFixture(0);
    sim.addItem({
      id: 101,
      name: 'Helm',
      description: '',
      sprite: 0,
      type: 'helmet',
    });
    sim.addItem({
      id: 102,
      name: 'Boots',
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
    refusePlayerData();

    equipItem(alice, 101);
    equipItem(alice, 102);
    handleChatCommand(alice, '/sets');
    handleChatCommand(alice, '/sets');

    expect(alice.attack).toBe(10);
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

  // Each boot counts ticks from zero, so a five-second fury saved ten hours
  // into the last run would otherwise last ten more hours into this one.
  it('a status saved under an older clock lasts no longer than its duration', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({
      name: 'Alice',
      data: {
        statusEffects: [
          {
            id: 'fury',
            name: 'Fury',
            durationTicks: 100,
            expiresAt: 720_100,
            outgoingDamageMultiplier: 1.5,
          },
        ],
      },
    });

    sim.step(1);
    expect(alice.data?.['statusEffects']).toHaveLength(1);
    sim.step(100);

    expect(alice.data?.['statusEffects']).toEqual([]);
  });
});
