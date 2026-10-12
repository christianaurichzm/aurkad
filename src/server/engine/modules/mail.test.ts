// The real module and delivery queue against an in-memory MongoDB.
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from 'vitest';
import mongoose from 'mongoose';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startMemoryMongo } from '../../../test/mongo.js';
import { playerRepository } from '../../persistence/playerRepository.js';
import DeliveryModel from '../../model/Delivery.js';
import { gameConfig } from '../../gameConfig.js';
import { unloadAllModules } from './moduleLoader.js';
import { loadModulesForTest } from '../../../test/modules.js';
import { clearProvides, useApi } from './registry.js';
import { clearCommands } from '../commands.js';
import { clearAll } from '../hooks.js';
import { createFixture } from '../../sim/simFixture.js';
import type { PlayerServer } from '../../../shared/types.js';

const COIN = 3;
const SWORD = 1;

let mongod: MongoMemoryServer;
let sim: ReturnType<typeof createFixture>;

beforeAll(async () => {
  mongod = await startMemoryMongo();
  await mongoose.connect(mongod.getUri());
}, 30_000);
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})),
  );
  clearAll();
  clearCommands();
  clearProvides();
  sim = createFixture(0);
  sim.addItem({ id: COIN, name: 'Gold', type: 'misc' } as never);
  sim.addItem({ id: SWORD, name: 'Sword', type: 'weapon' } as never);
  gameConfig.modules['mail'] = {
    ...gameConfig.modules['mail'],
    config: { costPerLetter: 10, currencyItemId: COIN },
  };
  loadModulesForTest('mail');
});

afterEach(() => {
  unloadAllModules();
  clearAll();
  clearProvides();
  delete gameConfig.modules['mail']?.config;
});

const mail = () =>
  useApi<{
    send: (
      player: PlayerServer,
      to: string,
      itemId: number,
      quantity: number,
      message: string,
    ) => Promise<string>;
  }>('mail')!;

async function playerWith(
  name: string,
  items: { item: number; quantity: number }[],
) {
  const player = sim.addPlayer({ name });
  player.inventory.items = items.map((entry) => ({ ...entry }));
  await playerRepository.insert({ ...player, password: 'hash' });
  return player;
}

const gold = (player: PlayerServer) =>
  player.inventory.items.find((entry) => entry.item === COIN)?.quantity ?? 0;

describe('postage', () => {
  it('is charged only for the letters that went out when two overlap', async () => {
    const ana = await playerWith('Ana', [
      { item: SWORD, quantity: 2 },
      { item: COIN, quantity: 100 },
    ]);
    await playerWith('Bea', []);

    await Promise.all([
      mail().send(ana, 'Bea', SWORD, 1, ''),
      mail().send(ana, 'Bea', SWORD, 1, ''),
    ]);
    const sent = await DeliveryModel.countDocuments({ to: 'Bea' });

    expect(sent).toBeGreaterThan(0);
    expect(gold(ana)).toBe(100 - 10 * sent);
  });
});
