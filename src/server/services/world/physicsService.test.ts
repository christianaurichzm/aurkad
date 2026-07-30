/**
 * Where an entity lands when something puts it somewhere. A script
 * teleport, a GM bring or goto, a warp and a respawn skip the per-step
 * collision check, and an overlap they caused is not transient: two
 * players stay on one tile until somebody walks away.
 */
import { describe, it, expect } from 'vitest';
import { createFixture, tile } from '../../sim/simFixture.js';
import { findPlacement } from './physicsService.js';
import { respawnPlayer } from '../player/playerService.js';
import { rebuildQuadtree } from '../../spatial/spatialManager.js';
import { gameConfig, respawnPosition } from '../../gameConfig.js';
import { runtimeState } from '../../sim/state.js';
import type { CombatTarget } from '../../../shared/types.js';

const probe = (sim: ReturnType<typeof createFixture>, id = 'probe') =>
  ({
    id,
    kind: 'player',
    mapId: sim.mapId,
    width: 48,
    height: 48,
    position: { x: 0, y: 0 },
  }) as CombatTarget;

describe('findPlacement', () => {
  it('leaves a free tile alone', () => {
    const sim = createFixture(0);
    rebuildQuadtree(sim.mapId, sim.map);

    expect(findPlacement(probe(sim), sim.mapId, tile(5, 5))).toEqual(
      tile(5, 5),
    );
  });

  it('steps aside when someone is already standing there', () => {
    const sim = createFixture(0);
    sim.addPlayer({ name: 'Alice', position: tile(5, 5) });
    rebuildQuadtree(sim.mapId, sim.map);

    const placed = findPlacement(probe(sim), sim.mapId, tile(5, 5));

    expect(placed).not.toEqual(tile(5, 5));
    // Adjacent, not across the map.
    expect(Math.abs(placed.x - tile(5, 5).x)).toBeLessThanOrEqual(64);
    expect(Math.abs(placed.y - tile(5, 5).y)).toBeLessThanOrEqual(64);
  });

  it('does not treat the entity itself as an obstacle', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice', position: tile(5, 5) });
    rebuildQuadtree(sim.mapId, sim.map);

    const self = {
      ...probe(sim, alice.id),
      width: alice.width,
    } as CombatTarget;
    expect(findPlacement(self, sim.mapId, tile(5, 5))).toEqual(tile(5, 5));
  });

  it('skips blocked tiles as well as occupied ones', () => {
    const sim = createFixture(0);
    sim.addPlayer({ name: 'Alice', position: tile(5, 5) });
    // Wall off everything the first ring would offer except one tile.
    for (const [col, row] of [
      [4, 4],
      [5, 4],
      [6, 4],
      [4, 5],
      [6, 5],
      [4, 6],
      [5, 6],
    ]) {
      sim.map.tiles[row!]![col!] = { tileIndex: 0, blocked: true };
    }
    rebuildQuadtree(sim.mapId, sim.map);

    expect(findPlacement(probe(sim), sim.mapId, tile(5, 5))).toEqual(
      tile(6, 6),
    );
  });

  // A teleport that silently does not happen is worse than an overlap: the GM
  // sees the player stay put and nothing says why.
  it('still lands when there is nowhere free', () => {
    const sim = createFixture(0);
    for (let col = 0; col < 12; col++) {
      for (let row = 0; row < 12; row++) {
        sim.map.tiles[row]![col] = { tileIndex: 0, blocked: true };
      }
    }
    rebuildQuadtree(sim.mapId, sim.map);

    expect(findPlacement(probe(sim), sim.mapId, tile(5, 5))).toEqual(
      tile(5, 5),
    );
  });

  // Placement happens inside the simulation, so two runs of the same session
  // have to choose the same tile or a replay diverges from what it recorded.
  it('chooses the same tile every time', () => {
    const sim = createFixture(0);
    sim.addPlayer({ name: 'Alice', position: tile(5, 5) });
    rebuildQuadtree(sim.mapId, sim.map);

    const first = findPlacement(probe(sim), sim.mapId, tile(5, 5));
    const second = findPlacement(probe(sim), sim.mapId, tile(5, 5));

    expect(first).toEqual(second);
  });
});

describe('respawn', () => {
  // Everyone respawns on the same tile, so without placement a party wipe
  // would stack the whole group on one square.
  it('does not stack the dead on one tile', () => {
    const sim = createFixture(0);
    // Respawn sends players to the configured start map, so the fixture map
    // has to BE that map for the placement check to have anything to read.
    const startMapId = gameConfig.world.startMapId;
    runtimeState.maps[startMapId] = sim.map;
    const alice = sim.addPlayer({ name: 'Alice', position: tile(2, 2) });
    const bob = sim.addPlayer({ name: 'Bob', position: tile(3, 3) });

    respawnPlayer(alice);
    rebuildQuadtree(startMapId, sim.map);
    respawnPlayer(bob);

    expect(alice.position).toEqual(respawnPosition);
    expect(bob.position).not.toEqual(alice.position);
  });
});
