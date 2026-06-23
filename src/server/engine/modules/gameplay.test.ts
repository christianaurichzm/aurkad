import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadModules, unloadAllModules } from './moduleLoader.js';
import { useApi, clearProvides } from './registry.js';
import { handleChatCommand, clearCommands } from '../commands.js';
import { clearAll } from '../hooks.js';
import { drainGameEvents } from '../eventBus.js';
import { clearKvStoreMemory, kvGet } from '../../persistence/kvStore.js';
import { createFixture, tile } from '../../sim/simFixture.js';
import { awardExperience } from '../../services/playerService.js';
import { equipItem } from '../../services/inventoryService.js';
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

beforeEach(() => {
  clearAll();
  clearCommands();
  clearProvides();
  clearKvStoreMemory();
  drainGameEvents();
  loadModules();
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

  it('trade swaps offered items when the recipient accepts', () => {
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

    expect(
      alice.inventory.items.find((entry) => entry.item === 30)?.quantity,
    ).toBe(1);
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

  it('bank deposits and withdraws item stacks through KV storage', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({
      name: 'Alice',
      inventory: { items: [{ item: 30, quantity: 5 }], maxCapacity: 10 },
    });

    handleChatCommand(alice, '/bank deposit 30 3');

    expect(
      alice.inventory.items.find((entry) => entry.item === 30)?.quantity,
    ).toBe(2);
    expect(
      kvGet<{ items: Array<{ item: number; quantity: number }> }>(
        'bank',
        'Alice',
      )?.items,
    ).toEqual([{ item: 30, quantity: 3 }]);

    handleChatCommand(alice, '/bank withdraw 30 2');

    expect(
      alice.inventory.items.find((entry) => entry.item === 30)?.quantity,
    ).toBe(4);
    expect(
      kvGet<{ items: Array<{ item: number; quantity: number }> }>(
        'bank',
        'Alice',
      )?.items,
    ).toEqual([{ item: 30, quantity: 1 }]);
  });

  it('equipment applies and removes configured set bonuses', async () => {
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

    await equipItem(alice, 101);
    await equipItem(alice, 102);
    sim.step(20);

    expect(alice.attack).toBe(17);
    expect(equipment?.activeSets(alice).map((set) => set.id)).toEqual([
      'scout',
    ]);

    await equipItem(alice, 102);
    sim.step(20);

    expect(alice.attack).toBe(10);
    expect(equipment?.activeSets(alice)).toEqual([]);
  });

  it('status effects modify damage and tick healing', async () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice' });
    const bob = sim.addPlayer({ name: 'Bob', health: 100, maxHealth: 100 });
    const status = useApi<StatusApi>('status');

    expect(status?.apply(alice, 'fury', { durationTicks: 40 })).toBe(true);
    expect(status?.apply(bob, 'shield', { durationTicks: 40 })).toBe(true);

    await resolveDamage(bob, 20, { attacker: alice, map: sim.map });

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
