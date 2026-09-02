/**
 * Where a player has to be standing to use a shop.
 *
 * A shop id travels to every client on the map chunk that carries its tile, so
 * an id in a request body says nothing about where the account sending it is.
 * These lock down that the answer is re-read from the world on every request,
 * which is what makes walking away close the shop with nothing to expire.
 */
import { describe, it, expect } from 'vitest';
import { shopOpenFor } from './shopService.js';
import { createFixture, tile } from '../../sim/simFixture.js';
import { Direction, Key } from '../../../shared/types.js';

function worldWithShop(shopId = 'armoury') {
  const sim = createFixture(0);
  sim.map.tiles[5]![5]!.shop = shopId;
  return sim;
}

describe('shopOpenFor', () => {
  it('lets a player standing on the shop tile use it', () => {
    const sim = worldWithShop();
    const player = sim.addPlayer({ name: 'Alice', position: tile(5, 5) });

    expect(shopOpenFor(player, 'armoury')).toBe(true);
  });

  it('refuses a player standing anywhere else', () => {
    const sim = worldWithShop();
    const player = sim.addPlayer({ name: 'Alice', position: tile(9, 9) });

    expect(shopOpenFor(player, 'armoury')).toBe(false);
  });

  it('refuses a shop id other than the one on the tile', () => {
    const sim = worldWithShop();
    const player = sim.addPlayer({ name: 'Alice', position: tile(5, 5) });

    expect(shopOpenFor(player, 'blacksmith')).toBe(false);
  });

  // The permission follows the player rather than being granted once when
  // the shop opened.
  it('stops applying once the player walks off the tile', () => {
    const sim = worldWithShop();
    const player = sim.addPlayer({
      name: 'Alice',
      position: tile(5, 5),
      direction: Direction.Right,
    });
    expect(shopOpenFor(player, 'armoury')).toBe(true);

    sim.press('Alice', Key.ArrowRight);
    sim.step(20);

    expect(player.position).not.toEqual(tile(5, 5));
    expect(shopOpenFor(player, 'armoury')).toBe(false);
  });

  it('refuses a player whose map is not loaded here', () => {
    const sim = worldWithShop();
    const player = sim.addPlayer({ name: 'Alice', position: tile(5, 5) });
    player.mapId = 'somewhere-else';

    expect(shopOpenFor(player, 'armoury')).toBe(false);
  });
});
