/**
 * Bot placement and the check that refuses to call a crowd a spread, a
 * failure that is silent because the run still produces a number.
 */
import { describe, it, expect } from 'vitest';
import {
  assessWorld,
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

describe('planning where bots stand', () => {
  it('divides them between the maps', () => {
    const placements = planPlacements(SEEDED, names(10));

    expect(placements).toHaveLength(10);
    const perMap = new Map<string, number>();
    for (const p of placements) {
      perMap.set(p.mapId, (perMap.get(p.mapId) ?? 0) + 1);
    }
    expect(perMap.get('1')).toBe(5);
    expect(perMap.get('2')).toBe(5);
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
