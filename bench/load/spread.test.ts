/**
 * Bot placement and the check that refuses to call a crowd a spread, a
 * failure that is silent because the run still produces a number.
 */
import { describe, it, expect } from 'vitest';
import {
  assessWorld,
  planGathering,
  planPlacements,
  summarizeDistribution,
  type LoadMap,
} from './spread.js';

const map = (id: string, tileWidth: number, tileHeight: number): LoadMap => ({
  id,
  name: id,
  tileWidth,
  tileHeight,
});

// The world `npm run seed` builds: two maps, each 20x14 tiles, and a viewport
// is 20x14 tiles.
const SEEDED = [map('1', 20, 14), map('2', 20, 14)];
const names = (n: number) =>
  Array.from({ length: n }, (_, i) => `loadbot_${i}`);

const countByMap = (placements: Array<{ mapId: string }>) => {
  const perMap = new Map<string, number>();
  for (const p of placements) {
    perMap.set(p.mapId, (perMap.get(p.mapId) ?? 0) + 1);
  }
  return perMap;
};

describe('planning where bots stand', () => {
  it('divides them between the maps', () => {
    const perMap = countByMap(planPlacements(SEEDED, names(10)));

    expect(perMap.get('1')).toBe(5);
    expect(perMap.get('2')).toBe(5);
  });

  // The share is per screen, not per map: a round robin would put half the
  // bots on the one-screen town.
  it('gives each map the share of the population its size can hold', () => {
    const world = [map('town', 20, 14), map('moor', 100, 56)];

    const perMap = countByMap(planPlacements(world, names(210)));

    expect(perMap.get('town')).toBe(10);
    expect(perMap.get('moor')).toBe(200);
  });

  // On a fixed world, population and density move together, so a series
  // of runs cannot tell their costs apart.
  it('holds density still when asked, and uses more world instead', () => {
    const world = [map('moor', 100, 56)]; // 20 screens

    const small = planPlacements(world, names(90), 9);
    const large = planPlacements(world, names(180), 9);

    expect(new Set(small.map((p) => `${p.tileX},${p.tileY}`)).size).toBe(90);
    // Twice the bots over twice the screens keeps the same neighbours.
    expect(new Set(large.map((p) => `${p.tileX},${p.tileY}`)).size).toBe(180);
  });

  it('cannot grant a density the world has no room for', () => {
    const world = [map('moor', 100, 56)]; // 20 screens
    const assessment = assessWorld(world, 1000, 5);

    expect(assessment.perScreen).toBe(50);
    expect(assessment.warnings.join(' ')).toMatch(/stands at 50 per screen/);
    expect(planPlacements(world, names(1000), 5)).toHaveLength(1000);
  });

  it('keeps every placement inside the map, clear of the border', () => {
    for (const p of planPlacements(SEEDED, names(60))) {
      expect(p.tileX).toBeGreaterThanOrEqual(1);
      expect(p.tileY).toBeGreaterThanOrEqual(1);
      expect(p.tileX).toBeLessThan(20);
      expect(p.tileY).toBeLessThan(14);
    }
  });

  it('spreads them out instead of stacking them on one tile', () => {
    const placements = planPlacements([map('big', 200, 200)], names(16));
    const tiles = new Set(placements.map((p) => `${p.tileX},${p.tileY}`));

    expect(tiles.size).toBe(16);
  });

  // A load number should move with the server, not with where bots landed.
  it('is deterministic', () => {
    expect(planPlacements(SEEDED, names(30))).toEqual(
      planPlacements(SEEDED, names(30)),
    );
  });

  it('has nothing to do when there are no maps', () => {
    expect(planPlacements([], names(5))).toEqual([]);
  });
});

// Accounts stay where a spread run moved them, so a crowd run puts them back.
describe('planning a crowd', () => {
  const world = [map('1', 20, 14), map('3', 60, 42)];

  it('puts everyone on the start map', () => {
    const placements = planGathering(world, names(50), '1');

    expect(placements).toHaveLength(50);
    expect(new Set(placements.map((p) => p.mapId))).toEqual(new Set(['1']));
  });

  it('keeps the crowd inside one viewport, so they are in view of each other', () => {
    for (const p of planGathering([map('3', 60, 42)], names(120), '3')) {
      expect(p.tileX).toBeGreaterThanOrEqual(1);
      expect(p.tileY).toBeGreaterThanOrEqual(1);
      // A viewport is 20x14 tiles, centred on a 60x42 map.
      expect(p.tileX).toBeLessThan(21 + 20);
      expect(p.tileY).toBeLessThan(15 + 14);
    }
  });

  it('falls back to the first map when the named one is gone', () => {
    const placements = planGathering(world, names(3), 'deleted');

    expect(placements.map((p) => p.mapId)).toEqual(['1', '1', '1']);
  });

  it('has nothing to do without maps or without bots', () => {
    expect(planGathering([], names(5), '1')).toEqual([]);
    expect(planGathering(world, [], '1')).toEqual([]);
  });
});

describe('judging whether the world can hold a spread', () => {
  // Placement cannot separate anybody when every map is one screen.
  it('says so when every map is one screen', () => {
    const assessment = assessWorld(SEEDED, 100);

    expect(assessment.screenSizedMaps).toEqual(['1', '2']);
    expect(assessment.warnings.join(' ')).toMatch(/one screen or smaller/);
  });

  it('counts the viewports of room a bigger world has', () => {
    // 100x100 tiles is five viewports across and seven down.
    const assessment = assessWorld([map('wide', 100, 100)], 10);

    expect(assessment.viewportsAvailable).toBe(35);
    expect(assessment.screenSizedMaps).toEqual([]);
  });

  it('calls a run a crowd when there are too many bots for the room', () => {
    const assessment = assessWorld([map('wide', 100, 100)], 1000);

    expect(assessment.warnings.join(' ')).toMatch(/crowd scenario/);
  });

  it('stays quiet when the world can actually hold the population', () => {
    const assessment = assessWorld([map('wide', 400, 400)], 100);

    expect(assessment.warnings).toEqual([]);
  });

  it('says something rather than dividing by zero on an empty world', () => {
    expect(assessWorld([], 10).warnings).toContain('no maps to place bots on');
  });
});

describe('reading the distribution back', () => {
  it('reports how many maps ended up occupied', () => {
    const summary = summarizeDistribution([
      { mapId: '1', players: 40 },
      { mapId: '2', players: 60 },
      { mapId: '3', players: 0 },
    ]);

    expect(summary).toMatch(/2\/3 maps occupied/);
    expect(summary).toMatch(/busiest holds 60/);
  });

  it('has an answer when the server told it nothing', () => {
    expect(summarizeDistribution([])).toBe('no per-map data');
  });
});
