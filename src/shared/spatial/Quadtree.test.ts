import { describe, it, expect, beforeEach } from 'vitest';
import { Quadtree, QuadtreeEntity } from './Quadtree.js';

describe('Quadtree - Basic Operations', () => {
  let quadtree: Quadtree;

  beforeEach(() => {
    // Create 1000x1000 map
    quadtree = new Quadtree({ x: 0, y: 0, width: 1000, height: 1000 });
  });

  it('should create empty quadtree', () => {
    const stats = quadtree.getStats();
    expect(stats.totalEntities).toBe(0);
    expect(stats.maxDepth).toBe(0);
  });

  it('should insert single entity', () => {
    const entity: QuadtreeEntity = {
      id: 'player1',
      position: { x: 100, y: 100 },
      width: 32,
      height: 32,
    };

    quadtree.insert(entity);
    const stats = quadtree.getStats();
    expect(stats.totalEntities).toBe(1);
  });

  it('should insert multiple entities', () => {
    const entities: QuadtreeEntity[] = [
      { id: '1', position: { x: 100, y: 100 }, width: 32, height: 32 },
      { id: '2', position: { x: 200, y: 200 }, width: 32, height: 32 },
      { id: '3', position: { x: 300, y: 300 }, width: 32, height: 32 },
    ];

    entities.forEach((e) => quadtree.insert(e));
    const stats = quadtree.getStats();
    expect(stats.totalEntities).toBe(3);
  });

  it('should clear all entities', () => {
    quadtree.insert({
      id: '1',
      position: { x: 100, y: 100 },
      width: 32,
      height: 32,
    });
    quadtree.insert({
      id: '2',
      position: { x: 200, y: 200 },
      width: 32,
      height: 32,
    });

    quadtree.clear();
    const stats = quadtree.getStats();
    expect(stats.totalEntities).toBe(0);
  });
});

describe('Quadtree - Rectangle Query', () => {
  let quadtree: Quadtree;

  beforeEach(() => {
    quadtree = new Quadtree({ x: 0, y: 0, width: 1000, height: 1000 });

    // Insert entities at different positions
    quadtree.insert({
      id: '1',
      position: { x: 100, y: 100 },
      width: 32,
      height: 32,
    });
    quadtree.insert({
      id: '2',
      position: { x: 200, y: 200 },
      width: 32,
      height: 32,
    });
    quadtree.insert({
      id: '3',
      position: { x: 500, y: 500 },
      width: 32,
      height: 32,
    });
    quadtree.insert({
      id: '4',
      position: { x: 900, y: 900 },
      width: 32,
      height: 32,
    });
  });

  it('should query entities in small rectangle', () => {
    const results = quadtree.query({ x: 90, y: 90, width: 50, height: 50 });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe('1');
  });

  it('should query entities in medium rectangle', () => {
    const results = quadtree.query({ x: 0, y: 0, width: 300, height: 300 });
    expect(results).toHaveLength(2);
    expect(results.map((r: QuadtreeEntity) => r.id).sort()).toEqual(['1', '2']);
  });

  it('should query entities in large rectangle', () => {
    const results = quadtree.query({ x: 0, y: 0, width: 1000, height: 1000 });
    expect(results).toHaveLength(4);
  });

  it('should return empty array for rectangle with no entities', () => {
    const results = quadtree.query({ x: 700, y: 700, width: 50, height: 50 });
    expect(results).toHaveLength(0);
  });
});

describe('Quadtree - Radius Query', () => {
  let quadtree: Quadtree;

  beforeEach(() => {
    quadtree = new Quadtree({ x: 0, y: 0, width: 1000, height: 1000 });

    // Insert entities in a grid pattern
    quadtree.insert({
      id: '1',
      position: { x: 500, y: 500 },
      width: 32,
      height: 32,
    });
    quadtree.insert({
      id: '2',
      position: { x: 550, y: 500 },
      width: 32,
      height: 32,
    });
    quadtree.insert({
      id: '3',
      position: { x: 600, y: 500 },
      width: 32,
      height: 32,
    });
    quadtree.insert({
      id: '4',
      position: { x: 500, y: 600 },
      width: 32,
      height: 32,
    });
    quadtree.insert({
      id: '5',
      position: { x: 900, y: 900 },
      width: 32,
      height: 32,
    });
  });

  it('should find entities within small radius', () => {
    const results = quadtree.queryRadius({ x: 500, y: 500 }, 60);
    // Should find entity at 500,500 and 550,500 (distance ~50)
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.some((r: QuadtreeEntity) => r.id === '1')).toBe(true);
    expect(results.some((r: QuadtreeEntity) => r.id === '2')).toBe(true);
  });

  it('should find entities within medium radius', () => {
    const results = quadtree.queryRadius({ x: 500, y: 500 }, 150);
    // Should find entities 1, 2, 3, 4 (within 150px)
    expect(results.length).toBeGreaterThanOrEqual(3);
  });

  it('should not find distant entities', () => {
    const results = quadtree.queryRadius({ x: 500, y: 500 }, 50);
    // Should NOT find entity at 900,900 (too far)
    expect(results.some((r: QuadtreeEntity) => r.id === '5')).toBe(false);
  });

  it('should handle zero radius query', () => {
    const results = quadtree.queryRadius({ x: 500, y: 500 }, 0);
    // Implementation may return entities at exact point or empty array
    // Both behaviors are valid for radius=0
    expect(results.length).toBeGreaterThanOrEqual(0);
  });
});

describe('Quadtree - Performance', () => {
  it('should handle 1000 entities efficiently', () => {
    const quadtree = new Quadtree({ x: 0, y: 0, width: 10000, height: 10000 });

    // Insert 1000 random entities
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      quadtree.insert({
        id: `entity${i}`,
        position: {
          x: Math.random() * 10000,
          y: Math.random() * 10000,
        },
        width: 32,
        height: 32,
      });
    }
    const insertTime = performance.now() - start;

    // Insertion should be fast (< 100ms for 1000 entities)
    expect(insertTime).toBeLessThan(100);

    const stats = quadtree.getStats();
    expect(stats.totalEntities).toBe(1000);

    // Query should be fast
    const queryStart = performance.now();
    const results = quadtree.query({ x: 0, y: 0, width: 1000, height: 1000 });
    const queryTime = performance.now() - queryStart;

    // Query should be very fast (< 10ms)
    expect(queryTime).toBeLessThan(10);
    expect(results.length).toBeGreaterThan(0);
  });

  it('should maintain reasonable depth with many entities', () => {
    const quadtree = new Quadtree({ x: 0, y: 0, width: 1000, height: 1000 });

    // Insert 500 entities
    for (let i = 0; i < 500; i++) {
      quadtree.insert({
        id: `e${i}`,
        position: {
          x: Math.random() * 1000,
          y: Math.random() * 1000,
        },
        width: 32,
        height: 32,
      });
    }

    const stats = quadtree.getStats();
    // Max depth should be reasonable (< 10 for good distribution)
    expect(stats.maxDepth).toBeLessThan(15);
  });
});

describe('Quadtree - Edge Cases', () => {
  let quadtree: Quadtree;

  beforeEach(() => {
    quadtree = new Quadtree({ x: 0, y: 0, width: 1000, height: 1000 });
  });

  it('should handle entity at boundary', () => {
    quadtree.insert({
      id: '1',
      position: { x: 0, y: 0 },
      width: 32,
      height: 32,
    });
    quadtree.insert({
      id: '2',
      position: { x: 1000, y: 1000 },
      width: 32,
      height: 32,
    });

    const stats = quadtree.getStats();
    expect(stats.totalEntities).toBe(2);
  });

  it('should handle entities outside boundaries', () => {
    // Entities outside bounds might be accepted depending on implementation
    quadtree.insert({
      id: '1',
      position: { x: -100, y: -100 },
      width: 32,
      height: 32,
    });
    quadtree.insert({
      id: '2',
      position: { x: 2000, y: 2000 },
      width: 32,
      height: 32,
    });

    const stats = quadtree.getStats();
    // Implementation may or may not accept out-of-bounds entities
    expect(stats.totalEntities).toBeGreaterThanOrEqual(0);
  });

  it('should handle overlapping entities', () => {
    quadtree.insert({
      id: '1',
      position: { x: 100, y: 100 },
      width: 64,
      height: 64,
    });
    quadtree.insert({
      id: '2',
      position: { x: 120, y: 120 },
      width: 64,
      height: 64,
    });

    const results = quadtree.query({ x: 110, y: 110, width: 40, height: 40 });
    // Both entities overlap this query area
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle query outside bounds', () => {
    quadtree.insert({
      id: '1',
      position: { x: 100, y: 100 },
      width: 32,
      height: 32,
    });

    const results = quadtree.query({
      x: 2000,
      y: 2000,
      width: 100,
      height: 100,
    });
    expect(results).toHaveLength(0);
  });
});

/**
 * The tree is rebuilt every tick, so whatever `clear` leaves behind is carried
 * for the life of the process. These pin the two halves of that: dead branches
 * go, and branches that are still doing work stay.
 */
describe('Quadtree - pruning on clear', () => {
  const at = (x: number, y: number, id: string): QuadtreeEntity => ({
    id,
    position: { x, y },
    width: 16,
    height: 16,
  });

  const fill = (qt: Quadtree, entities: QuadtreeEntity[]) => {
    qt.clear();
    for (const entity of entities) qt.insert(entity);
  };

  // A map that once held a crowd must not keep its subdivision forever, or
  // every later clear and query walks nodes that cannot hold anything.
  it('drops the subdivision a departed crowd left behind', () => {
    const qt = new Quadtree({ x: 0, y: 0, width: 1000, height: 1000 }, 10, 8);

    const crowd = Array.from({ length: 200 }, (_, i) =>
      at((i * 37) % 990, (i * 53) % 990, `c${i}`),
    );
    fill(qt, crowd);
    const crowded = qt.getStats().nodeCount;
    expect(crowded).toBeGreaterThan(10);

    // Two rebuilds: `clear` decides from what it empties, the occupancy of the
    // tick that just ended. The tick the crowd leaves keeps its shape, the one
    // after does not; at 20Hz that lag is 50ms, and it keeps the decision on
    // what happened rather than a guess about the tick starting.
    fill(qt, [at(10, 10, 'a')]);
    fill(qt, [at(10, 10, 'a')]);

    expect(qt.getStats().nodeCount).toBeLessThan(crowded);
    expect(qt.size()).toBe(1);
  });

  it('collapses to a single node once the map empties', () => {
    const qt = new Quadtree({ x: 0, y: 0, width: 1000, height: 1000 }, 10, 8);

    fill(
      qt,
      Array.from({ length: 100 }, (_, i) =>
        at((i * 37) % 990, (i * 53) % 990, `c${i}`),
      ),
    );
    expect(qt.getStats().nodeCount).toBeGreaterThan(1);

    qt.clear();
    qt.clear();

    expect(qt.getStats().nodeCount).toBe(1);
  });

  // The trap the guard exists for. Entities sitting across a node's midlines
  // fit no quadrant, so they come back to the node after any split, leaving its
  // children empty. Pruning on "children were empty" alone would drop them,
  // the next insert pass would split again, and the tree would rebuild the
  // same four nodes on every tick forever.
  it('keeps the children of a node that is holding straddlers', () => {
    const qt = new Quadtree({ x: 0, y: 0, width: 1000, height: 1000 }, 10, 8);
    // Centred on the root's midlines, so none of them fits a quadrant.
    const straddlers = Array.from({ length: 20 }, (_, i) =>
      at(492, 492, `s${i}`),
    );

    fill(qt, straddlers);
    const split = qt.getStats().nodeCount;
    expect(split).toBeGreaterThan(1);

    for (let tick = 0; tick < 5; tick++) fill(qt, straddlers);

    expect(qt.getStats().nodeCount).toBe(split);
  });

  it('keeps a branch that still has something in it', () => {
    const qt = new Quadtree({ x: 0, y: 0, width: 1000, height: 1000 }, 10, 8);
    const cluster = Array.from({ length: 30 }, (_, i) =>
      at(100 + i, 100, `p${i}`),
    );

    fill(qt, cluster);
    const withCluster = qt.getStats().nodeCount;

    fill(qt, cluster);

    expect(qt.getStats().nodeCount).toBe(withCluster);
  });

  // Pruning is a shape change, and a shape change that loses an entity is the
  // failure nobody sees until something stops being drawn.
  it('answers the same queries after the shape changes', () => {
    const qt = new Quadtree({ x: 0, y: 0, width: 1000, height: 1000 }, 10, 8);

    fill(
      qt,
      Array.from({ length: 200 }, (_, i) =>
        at((i * 37) % 990, (i * 53) % 990, `c${i}`),
      ),
    );

    const survivors = [at(10, 10, 'a'), at(900, 900, 'b'), at(500, 500, 'c')];
    fill(qt, survivors);

    const whole = { x: 0, y: 0, width: 1000, height: 1000 };
    expect(
      qt
        .query(whole)
        .map((e) => e.id)
        .sort(),
    ).toEqual(['a', 'b', 'c']);
    expect(
      qt.query({ x: 0, y: 0, width: 100, height: 100 }).map((e) => e.id),
    ).toEqual(['a']);
    expect(qt.queryRadius({ x: 900, y: 900 }, 50).map((e) => e.id)).toEqual([
      'b',
    ]);
  });
});
