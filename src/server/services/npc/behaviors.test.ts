import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { TILE_SIZE } from '../../../shared/constants.js';
import { Direction, type MapStateServer } from '../../../shared/types.js';
import { createFixture, makeTiles, tile } from '../../sim/simFixture.js';
import { findClosestPlayer, findPath } from './behaviors.js';
import { rebuildQuadtree } from '../../sim/spatialManager.js';

const walker = { id: 'w', kind: 'player', width: 64, height: 64 } as never;

const mapOf = (rows: number, cols: number, blocked: [number, number][]) => {
  const tiles = makeTiles(rows, cols);
  for (const [c, r] of blocked) tiles[r]![c]!.blocked = true;
  return { id: 'm', tiles, players: {}, npcs: {} } as unknown as MapStateServer;
};

/** Plain BFS over the same rules: the goal is always enterable. */
function shortest(
  map: MapStateServer,
  [sc, sr]: [number, number],
  [gc, gr]: [number, number],
  avoid: Set<string>,
): number | null {
  const dist = new Map([[`${sc},${sr}`, 0]]);
  const queue: [number, number][] = [[sc, sr]];
  for (let i = 0; i < queue.length; i++) {
    const [c, r] = queue[i]!;
    for (const [dc, dr] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ] as const) {
      const [nc, nr] = [c + dc, r + dr];
      const key = `${nc},${nr}`;
      if (dist.has(key)) continue;
      const t = map.tiles[nr]?.[nc];
      if (!t) continue;
      const d = dist.get(`${c},${r}`)! + 1;
      if (nc === gc && nr === gr) return d;
      if (t.blocked || avoid.has(key)) continue;
      dist.set(key, d);
      queue.push([nc, nr]);
    }
  }
  return null;
}

const SIDE = 16;

describe('findPath', () => {
  it('finds a shortest way within the depth, or says there is none', () => {
    const cell = fc.tuple(fc.nat({ max: SIDE - 1 }), fc.nat({ max: SIDE - 1 }));
    // Walls dense enough for mazes: a cell first reached the long way round
    // and then by a shorter one is what an A* that never revisits gets wrong.
    const walls = fc
      .tuple(
        fc.integer({ min: 15, max: 50 }),
        fc.array(fc.nat({ max: 99 }), {
          minLength: SIDE * SIDE,
          maxLength: SIDE * SIDE,
        }),
      )
      .map(([density, rolls]) =>
        rolls.flatMap((roll, i): [number, number][] =>
          roll < density ? [[i % SIDE, Math.floor(i / SIDE)]] : [],
        ),
      );
    fc.assert(
      fc.property(
        walls,
        fc.array(cell, { maxLength: 4 }),
        cell,
        cell,
        fc.integer({ min: 1, max: 40 }),
        (blocked, avoid, from, to, depth) => {
          const map = mapOf(SIDE, SIDE, blocked);
          map.tiles[from[1]]![from[0]]!.blocked = false;
          const steps = findPath(
            tile(...from),
            tile(...to),
            map,
            depth,
            walker,
            avoid.map((c) => tile(...c)),
          );
          const avoided = new Set(
            avoid
              .filter(([c, r]) => c !== to[0] || r !== to[1])
              .map(([c, r]) => `${c},${r}`),
          );
          const best =
            from[0] === to[0] && from[1] === to[1]
              ? null
              : shortest(map, from, to, avoided);

          if (best === null || best > depth) {
            expect(steps).toBeNull();
            return;
          }
          expect(steps).toHaveLength(best);
          let at = tile(...from);
          steps!.forEach((step, i) => {
            const dx = (step.x - at.x) / TILE_SIZE;
            const dy = (step.y - at.y) / TILE_SIZE;
            expect(Math.abs(dx) + Math.abs(dy)).toBe(1);
            expect(step.dir).toBe(
              dx > 0
                ? Direction.Right
                : dx < 0
                  ? Direction.Left
                  : dy > 0
                    ? Direction.Down
                    : Direction.Up,
            );
            if (i < steps!.length - 1) {
              const [c, r] = [step.x / TILE_SIZE, step.y / TILE_SIZE];
              expect(map.tiles[r]![c]!.blocked).toBe(false);
              expect(avoided.has(`${c},${r}`)).toBe(false);
            }
            at = step;
          });
          expect({ x: at.x, y: at.y }).toEqual(tile(...to));
        },
      ),
      { numRuns: 1000 },
    );
  });

  // Found by the property above against a search that kept the first cost a
  // cell was reached with: it came back two steps long.
  it('takes the shortest way through a maze that reaches a cell twice', () => {
    const maze = [
      '#....#.#...#....',
      '.#..#....##....#',
      '.......##.#.###.',
      '#......#........',
      '....#....#.#....',
      '..#........#.##.',
      '#.#.....###.##..',
      '..#............#',
      '#....#...#.#....',
      '...#.....###....',
      '..#.#..#...#....',
      '.....#.....#.##.',
      '..#....#...#....',
      '.#...#..........',
      '..............##',
      '#.#.....#.#.....',
    ];
    const map = mapOf(
      SIDE,
      SIDE,
      maze.flatMap((line, r) =>
        [...line].flatMap((ch, c): [number, number][] =>
          ch === '#' ? [[c, r]] : [],
        ),
      ),
    );

    expect(findPath(tile(0, 10), tile(14, 9), map, 40, walker)).toHaveLength(
      19,
    );
  });

  // The buffers are sized by the depth and reused, so a search on a map far
  // larger than the window, after one with a bigger depth, must still agree.
  it('answers the same on a large map whatever was searched before', () => {
    const map = mapOf(300, 300, []);
    for (let r = 140; r <= 160; r++) map.tiles[r]![150]!.blocked = true;

    findPath(tile(10, 10), tile(60, 10), map, 64, walker);
    const from = tile(148, 150);
    const to = tile(152, 150);

    // Over or under the wall: 4 across, 11 up and 11 back down.
    expect(findPath(from, to, map, 30, walker)).toHaveLength(26);
    expect(findPath(from, to, map, 25, walker)).toBeNull();
  });
});

describe('findClosestPlayer', () => {
  it('picks the nearest player still standing on the map', () => {
    const sim = createFixture(0);
    const npc = sim.addNpc({ position: tile(5, 5) });
    sim.addPlayer({ name: 'Dead', position: tile(5, 6), health: 0 });
    const gone = sim.addPlayer({ name: 'Gone', position: tile(4, 5) });
    const near = sim.addPlayer({ name: 'Near', position: tile(7, 5) });
    sim.addPlayer({ name: 'Far', position: tile(5, 9) });
    rebuildQuadtree(sim.mapId, sim.map);
    // Left the map after the tree was built this tick.
    delete sim.map.players[gone.id];

    expect(findClosestPlayer(npc, sim.map, 3 * TILE_SIZE)).toBe(near);
  });

  it('sees nobody past its radius', () => {
    const sim = createFixture(0);
    const npc = sim.addNpc({ position: tile(5, 5) });
    sim.addPlayer({ name: 'Far', position: tile(5, 12) });
    rebuildQuadtree(sim.mapId, sim.map);

    expect(findClosestPlayer(npc, sim.map, 3 * TILE_SIZE)).toBeNull();
  });
});
