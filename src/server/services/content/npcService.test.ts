import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startMemoryMongo } from '../../../test/mongo.js';
import { createFixture, tile } from '../../sim/simFixture.js';
import {
  replicatedEntityCount,
  resetEntityReplication,
} from '../../net/entityReplication.js';
import {
  createOrUpdateNpc,
  deleteNpc,
  getNpcById,
  refreshNpcInRuntime,
} from './npcService.js';

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

const goblin = {
  id: 'goblin',
  name: 'Goblin',
  sprite: 2,
  width: 64,
  height: 64,
  maxHealth: 30,
  attack: 5,
  behavior: 'aggressive' as const,
};

beforeEach(async () => {
  const cols = mongoose.connection.collections;
  await Promise.all(Object.values(cols).map((c) => c.deleteMany({})));
  sim = createFixture(0);
  resetEntityReplication();
  await createOrUpdateNpc(goblin);
});

/** Two goblins from one template, as a map with two spawn tiles has them. */
function placeGoblins() {
  sim.addNpc({ id: 'goblin:3:3', templateId: 'goblin', position: tile(3, 3) });
  sim.addNpc({ id: 'goblin:6:6', templateId: 'goblin', position: tile(6, 6) });
}

describe('getNpcById', () => {
  it('hands out the template without the document bookkeeping', async () => {
    const template = await getNpcById('goblin');
    expect(template).toMatchObject(goblin);
    expect(template).not.toHaveProperty('_id');
    expect(template).not.toHaveProperty('__v');
  });
});

describe('refreshNpcInRuntime', () => {
  it('brings every live instance up to the edit, each under its own id', async () => {
    placeGoblins();
    sim.step(1);

    await createOrUpdateNpc({ ...goblin, name: 'Hobgoblin' });
    await refreshNpcInRuntime('goblin');
    sim.step(1);

    for (const id of ['goblin:3:3', 'goblin:6:6']) {
      expect(sim.map.npcs[id]).toMatchObject({ id, name: 'Hobgoblin' });
    }
    expect(replicatedEntityCount()).toBe(2);
  });
});

describe('deleteNpc', () => {
  it('takes the live instances of the template off the maps', async () => {
    placeGoblins();
    const orc = sim.addNpc({ id: 'orc:1:1', templateId: 'orc' });
    sim.step(1);

    await deleteNpc('goblin');
    sim.step(1);

    expect(Object.keys(sim.map.npcs)).toEqual([orc.id]);
    expect(replicatedEntityCount()).toBe(1);
    expect(await getNpcById('goblin')).toBeNull();
  });
});
