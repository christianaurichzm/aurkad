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
  NpcSchema,
  refreshNpcInRuntime,
} from './npcService.js';
import { respawnNpc } from '../npc/index.js';

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

/**
 * Two goblins from one template, as a map with two spawn tiles has them, and
 * a player out of their sight: a map nobody stands on is not replicated, so
 * without one there would be no baselines to count.
 */
function placeGoblins() {
  sim.addNpc({ id: 'goblin:3:3', templateId: 'goblin', position: tile(3, 3) });
  sim.addNpc({ id: 'goblin:6:6', templateId: 'goblin', position: tile(6, 6) });
  sim.addPlayer({ name: 'Watcher', position: tile(19, 19) });
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
    // The two goblins and the watcher.
    expect(replicatedEntityCount()).toBe(3);
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
    // The orc and the watcher.
    expect(replicatedEntityCount()).toBe(2);
    expect(await getNpcById('goblin')).toBeNull();
  });

  it('keeps one killed before the delete from coming back', async () => {
    const npc = killGoblin();

    await deleteNpc('goblin');
    sim.step(30);

    expect(sim.map.npcs[npc.id]).toBeUndefined();
  });
});

describe('an npc awaiting respawn', () => {
  it('comes back as the edit made while it was dead', async () => {
    const npc = killGoblin();

    await createOrUpdateNpc({ ...goblin, name: 'Hobgoblin', maxHealth: 10 });
    await refreshNpcInRuntime('goblin');
    sim.step(30);

    expect(sim.map.npcs[npc.id]).toMatchObject({
      name: 'Hobgoblin',
      maxHealth: 10,
      health: 10,
    });
  });
});

/** A goblin on its spawn tile, killed, a second from coming back. */
function killGoblin() {
  sim.map.tiles[5]![5]!.npcSpawn = 'goblin';
  const npc = sim.addNpc({
    ...goblin,
    id: `${sim.mapId}:goblin:5:5`,
    templateId: 'goblin',
    position: tile(5, 5),
    respawnMs: 1000,
  });
  respawnNpc(sim.mapId, npc);
  return npc;
}

describe('NpcSchema', () => {
  it('accepts valid NPC', () => {
    const result = NpcSchema.safeParse({
      name: 'Goblin',
      sprite: 1,
      maxHealth: 100,
      attack: 10,
      behavior: 'aggressive',
    });
    expect(result.success).toBe(true);
  });
  it('accepts all valid behaviors', () => {
    const behaviors = [
      'aggressive',
      'hostile',
      'neutral',
      'friendly',
      'shopkeeper',
      'guard',
    ] as const;
    for (const behavior of behaviors) {
      expect(
        NpcSchema.safeParse({
          name: 'X',
          sprite: 0,
          maxHealth: 1,
          attack: 0,
          behavior,
        }).success,
      ).toBe(true);
    }
  });
  it('rejects unknown behavior', () => {
    expect(
      NpcSchema.safeParse({
        name: 'X',
        sprite: 0,
        maxHealth: 1,
        attack: 0,
        behavior: 'boss',
      }).success,
    ).toBe(false);
  });
  // z.object strips what it does not declare, so a field missing here is
  // saved by the editor and never reaches the database: the npc would come
  // back with no quest.
  it('keeps the content references an npc points at', () => {
    const result = NpcSchema.safeParse({
      name: 'X',
      sprite: 0,
      maxHealth: 1,
      attack: 0,
      behavior: 'neutral',
      lootTableId: 'common',
      dialogId: 'greet',
      questId: 'orcs',
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      lootTableId: 'common',
      dialogId: 'greet',
      questId: 'orcs',
    });
  });
  it('rejects zero or negative maxHealth', () => {
    expect(
      NpcSchema.safeParse({
        name: 'X',
        sprite: 0,
        maxHealth: 0,
        attack: 0,
        behavior: 'neutral',
      }).success,
    ).toBe(false);
  });
});
