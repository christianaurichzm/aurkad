import { describe, it, expect, vi } from 'vitest';
import { Key } from '../../../shared/types.js';
import { createFixture, tile } from '../../sim/simFixture.js';
import GameMapModel from '../../model/Map.js';

vi.mock('../../model/Map.js', () => ({
  default: {
    findOneAndUpdate: vi.fn(() => Promise.resolve()),
    updateOne: vi.fn(() => Promise.resolve()),
  },
}));

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
