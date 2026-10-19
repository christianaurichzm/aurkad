/**
 * That an entity leaving the world takes its per-entity state with it, or
 * every despawned summon and disconnected player leaves a public-state
 * snapshot behind for the life of the process.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordEntity,
  fragmentAt,
  resetEntityReplication,
  beginTick,
} from './entityReplication.js';
import { forgetReplicatedEntity } from './entityReplication.js';
import { spawnNpc, despawnNpc } from '../services/npc/spawn.js';
import { getOrInitNpcAi, clearAllNpcAiState } from '../services/npc/aiBrain.js';
import { createFixture } from '../sim/simFixture.js';

beforeEach(() => {
  resetEntityReplication();
  clearAllNpcAiState();
});

describe('forgetReplicatedEntity', () => {
  it('drops the entity so the next record starts from nothing', () => {
    beginTick();
    recordEntity('e1', { health: 10 });

    beginTick();
    recordEntity('e1', { health: 10 });
    // Unchanged between ticks, so a viewer that knows it gets no delta.
    expect(fragmentAt('e1')?.delta).toBeUndefined();

    forgetReplicatedEntity('e1');

    beginTick();
    recordEntity('e1', { health: 10 });
    // With no baseline there is nothing to diff against, so no delta; the
    // viewer is given full state instead.
    expect(fragmentAt('e1')?.delta).toBeUndefined();
    expect(fragmentAt('e1')?.full).toBe('{"health":10}');
  });
});

describe('despawnNpc', () => {
  it('removes the npc from the map', () => {
    const sim = createFixture(0);
    const npc = spawnNpc({ mapId: sim.mapId, col: 2, row: 2 })!;

    despawnNpc(npc);

    expect(sim.map.npcs[npc.id]).toBeUndefined();
  });

  it('drops its replication baseline', () => {
    const sim = createFixture(0);
    const npc = spawnNpc({ mapId: sim.mapId, col: 2, row: 2 })!;
    beginTick();
    recordEntity(npc.id, { health: 5 });

    despawnNpc(npc);

    beginTick();
    recordEntity(npc.id, { health: 5 });
    // A baseline left behind would make this a no-change delta instead.
    expect(fragmentAt(npc.id)?.full).toBe('{"health":5}');
    expect(fragmentAt(npc.id)?.delta).toBeUndefined();
  });

  // The AI key includes mapId, so passing the caller's bare `{ id }` through
  // would compute the wrong key and delete nothing.
  it('drops its ai state', () => {
    const sim = createFixture(0);
    const npc = spawnNpc({ mapId: sim.mapId, col: 2, row: 2 })!;
    const ai = getOrInitNpcAi(npc);
    ai.stuckTicks = 42;

    despawnNpc(npc);

    // Respawning the same id starts clean rather than inheriting the old state.
    const revived = spawnNpc({ mapId: sim.mapId, col: 2, row: 2 })!;
    expect(getOrInitNpcAi({ ...revived, id: npc.id }).stuckTicks).toBe(0);
  });

  it('does nothing for an npc that is not on any map', () => {
    createFixture(0);
    expect(() => despawnNpc({ id: 'never-existed' })).not.toThrow();
  });

  it('leaves other npcs alone', () => {
    const sim = createFixture(0);
    const a = spawnNpc({ mapId: sim.mapId, col: 2, row: 2 })!;
    const b = spawnNpc({ mapId: sim.mapId, col: 3, row: 2 })!;

    despawnNpc(a);

    expect(sim.map.npcs[b.id]).toBeDefined();
  });
});
