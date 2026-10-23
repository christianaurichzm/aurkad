import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Key } from '../../../shared/types.js';
import { createFixture, tile } from '../../sim/simFixture.js';
import GameMapModel from '../../model/Map.js';

vi.mock('../../model/Map.js', () => ({
  default: {
    findOneAndUpdate: vi.fn(() => Promise.resolve()),
    updateOne: vi.fn(() => Promise.resolve()),
  },
}));

// Every way a walk can ask for a path, counted on the way through.
const searches = vi.hoisted(() => ({ count: 0 }));
vi.mock('../npc/behaviors.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const counted =
    (name: string) =>
    (...args: unknown[]) => {
      searches.count++;
      return (actual[name] as (...a: unknown[]) => unknown)(...args);
    };
  return {
    ...actual,
    bfsNextStep: counted('bfsNextStep'),
    findPath: counted('findPath'),
  };
});

const { setMapTile } = await import('./mapService.js');

describe('a key door', () => {
  it('saves the tile it opened and nothing a script painted', () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({
      name: 'Alice',
      position: tile(1, 1),
      inventory: { items: [{ item: 9, quantity: 1 }], maxCapacity: 10 },
    });
    sim.map.tiles[1]![2] = {
      tileIndex: 5,
      blocked: true,
      door: { requiresItem: 9, openTileIndex: 6 },
    };
    setMapTile(sim.mapId, 7, 7, { tileIndex: 77, blocked: true });

    sim.press('Alice', Key.ArrowRight);
    sim.step();

    expect(player.position).toEqual(tile(2, 1));
    expect(player.inventory.items).toEqual([]);
    expect(sim.map.tiles[1]![2]).toEqual({ tileIndex: 6, blocked: false });
    expect(GameMapModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(GameMapModel.updateOne).toHaveBeenCalledExactlyOnceWith(
      { id: sim.mapId },
      { $set: { 'tiles.1.2': { tileIndex: 6, blocked: false } } },
    );
  });
});

describe('walking to a clicked cell', () => {
  beforeEach(() => {
    searches.count = 0;
  });

  it('searches once for the whole walk', () => {
    const sim = createFixture(0);
    sim.addPlayer({ name: 'Alice', position: tile(1, 1) });

    sim.moveTo('Alice', 9, 1);
    sim.step(60);

    expect(sim.getPlayer('Alice').position).toEqual(tile(9, 1));
    expect(searches.count).toBe(1);
  });

  it('searches again when someone steps onto the way', () => {
    const sim = createFixture(0);
    sim.addPlayer({ name: 'Alice', position: tile(1, 1) });

    sim.moveTo('Alice', 9, 1);
    sim.step(6);
    sim.addNpc({ behavior: 'friendly', position: tile(6, 1) });
    sim.step(60);

    expect(sim.getPlayer('Alice').position).toEqual(tile(9, 1));
    expect(searches.count).toBe(2);
  });

  it('searches again from wherever a push left the player', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice', position: tile(1, 1) });

    sim.moveTo('Alice', 9, 1);
    sim.step(12);
    alice.position = tile(4, 5);
    sim.step(80);

    expect(alice.position).toEqual(tile(9, 1));
    expect(searches.count).toBe(2);
  });
});
