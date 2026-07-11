import { describe, it, expect } from 'vitest';
import { createFixture, tile } from '../sim/simFixture.js';
import { rebuildQuadtree } from '../spatial/spatialManager.js';
import { toMapDynamicClient } from './serialization.js';
import type { Viewport } from '../../shared/mapGeometry.js';

const nearViewport: Viewport = { left: 0, top: 0, right: 200, bottom: 200 };

describe('toMapDynamicClient', () => {
  it('includes players and NPCs inside the viewport, excludes those outside', () => {
    const sim = createFixture(0);
    const viewer = sim.addPlayer({ name: 'Viewer', position: tile(0, 0) });
    const nearby = sim.addPlayer({ name: 'Nearby', position: tile(1, 1) });
    const far = sim.addPlayer({ name: 'Far', position: tile(10, 10) });
    const nearNpc = sim.addNpc({ name: 'NearNpc', position: tile(1, 2) });
    const farNpc = sim.addNpc({ name: 'FarNpc', position: tile(12, 12) });

    rebuildQuadtree(sim.mapId, sim.map);

    const dyn = toMapDynamicClient(sim.map, viewer, nearViewport);

    expect(Object.keys(dyn.players)).toEqual([nearby.id]);
    expect(Object.keys(dyn.npcs)).toEqual([nearNpc.id]);
    expect(dyn.players[far.id]).toBeUndefined();
    expect(dyn.npcs[farNpc.id]).toBeUndefined();
  });

  it('excludes the viewer themself from the players map', () => {
    const sim = createFixture(0);
    const viewer = sim.addPlayer({ name: 'Viewer', position: tile(0, 0) });
    rebuildQuadtree(sim.mapId, sim.map);

    const dyn = toMapDynamicClient(sim.map, viewer, nearViewport);

    expect(dyn.players[viewer.id]).toBeUndefined();
  });

  it('still filters dropped items by viewport (not quadtree-indexed)', () => {
    const sim = createFixture(0);
    const viewer = sim.addPlayer({ name: 'Viewer', position: tile(0, 0) });
    sim.map.droppedItems.push(
      { itemId: 1, position: tile(1, 1), sprite: 0, quantity: 1 },
      { itemId: 2, position: tile(12, 12), sprite: 0, quantity: 1 },
    );
    rebuildQuadtree(sim.mapId, sim.map);

    const dyn = toMapDynamicClient(sim.map, viewer, nearViewport);

    expect(dyn.droppedItems).toHaveLength(1);
    expect(dyn.droppedItems[0]?.itemId).toBe(1);
  });

  it('reflects entities added after the last quadtree rebuild as absent', () => {
    const sim = createFixture(0);
    const viewer = sim.addPlayer({ name: 'Viewer', position: tile(0, 0) });
    rebuildQuadtree(sim.mapId, sim.map);

    // Added after the rebuild: the quadtree has no record of it yet.
    const late = sim.addPlayer({ name: 'Late', position: tile(1, 1) });

    const dyn = toMapDynamicClient(sim.map, viewer, nearViewport);

    expect(dyn.players[late.id]).toBeUndefined();
  });
});
