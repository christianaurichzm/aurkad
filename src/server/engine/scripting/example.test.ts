/**
 * The script every new game starts with (game/scripts/example.js in
 * templates/new-game), run as the server runs it, against the real quest
 * module.
 */
import fs from 'node:fs';
import path from 'node:path';
import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runInSandbox, type ScriptHandle } from './sandbox.js';
import { clearAll, emit } from '../hooks.js';
import { clearCommands } from '../commands.js';
import { clearProvides, useApi } from '../modules/registry.js';
import { unloadAllModules } from '../modules/moduleLoader.js';
import { loadModulesForTest } from '../../../test/modules.js';
import { createFixture } from '../../sim/simFixture.js';
import { countItem } from '../../services/economy/economyService.js';
import type { Item, PlayerServer } from '../../../shared/types.js';

// No database: the write before a reward is mailed, and the mailbox row.
const { queueDelivery } = vi.hoisted(() => ({
  queueDelivery: vi.fn(() => Promise.resolve({ ok: true, id: 'row' })),
}));
vi.mock('../../services/player/playerService.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  persistPlayersNow: () => Promise.resolve(true),
}));
vi.mock(
  '../../services/economy/deliveryService.js',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    queueDelivery,
  }),
);

const POTION = 1;
const COIN = 2;
const source = fs.readFileSync(
  path.join(process.cwd(), 'templates/new-game/game/scripts/example.js'),
  'utf-8',
);

interface QuestApi {
  start: (p: PlayerServer, id: string) => boolean;
  advance: (p: PlayerServer, id: string, amount?: number) => void;
}

let sim: ReturnType<typeof createFixture>;
let handle: ScriptHandle;

beforeEach(() => {
  clearAll();
  clearCommands();
  clearProvides();
  sim = createFixture(0);
  for (const [id, name] of [
    [POTION, 'Health Potion'],
    [COIN, 'Gold Coin'],
  ] as const)
    sim.addItem({ id, name, sprite: 0, type: 'consumable' } as Item);
  loadModulesForTest('quest');
  handle = runInSandbox(source, 'example.js');
});

afterEach(() => {
  handle.cleanup();
  unloadAllModules();
  clearAll();
  clearProvides();
});

it('hands a new character the starter kit once', () => {
  const player = sim.addPlayer({ name: 'Alice' });
  emit('playerJoin', { player });
  expect(countItem(player.inventory, COIN)).toBe(10);

  // Still level 1 with an empty bag, the way a player farming it would be.
  player.inventory.items = [];
  emit('playerJoin', { player });
  expect(countItem(player.inventory, COIN)).toBe(0);
});

it('mails a quest reward the bag has no room for', async () => {
  const player = sim.addPlayer({
    name: 'Alice',
    experienceToNextLevel: 10_000,
    inventory: { items: [], maxCapacity: 0 },
  });
  const quest = useApi<QuestApi>('quest')!;
  quest.start(player, 'skeletonHunt');
  quest.advance(player, 'skeletonHunt', 3);

  expect(player.experience).toBe(100);
  await vi.waitFor(() =>
    expect(queueDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'Alice', itemId: POTION, quantity: 2 }),
    ),
  );
});
