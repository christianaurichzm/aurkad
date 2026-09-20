import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TILE_SIZE } from '../../../shared/constants.js';
import type {
  MapStateServer,
  PersistentNpc,
  Tile,
} from '../../../shared/types.js';

const getNpcById = vi.fn();
vi.mock('../npc/index.js', () => ({
  getNpcById: (id: string) => getNpcById(id),
}));

const { insertNpcs } = await import('./mapService.js');

const tiles = (npcId: string): Tile[][] => [
  [{ tileIndex: 0 }, { tileIndex: 0, npcSpawn: npcId }],
];

const runtime = async (stored: Partial<PersistentNpc>) => {
  getNpcById.mockResolvedValue({
    id: 'lia',
    name: 'Lia',
    sprite: 4,
    maxHealth: 200,
    attack: 0,
    behavior: 'friendly',
    ...stored,
  });
  const partial: Partial<MapStateServer> = {};
  await insertNpcs(partial, 'aurora', tiles('lia'));
  return Object.values(partial.npcs ?? {})[0]!;
};

beforeEach(() => getNpcById.mockReset());

// Documents reach this from anywhere: a content pack, a hand-edited
// collection, a pack from before the geometry defaults were a tile. A box
// narrower than a tile puts the health bar off the sprite and the tile
// next door out of melee reach, so instantiation normalises.
describe('insertNpcs geometry', () => {
  it('keeps geometry the document actually declares', async () => {
    const npc = await runtime({ width: 96, height: 96, attackRange: 128 });

    expect(npc.width).toBe(96);
    expect(npc.height).toBe(96);
    expect(npc.attackRange).toBe(128);
  });

  it('falls back to a tile when the document declares none', async () => {
    const npc = await runtime({});

    expect(npc.width).toBe(TILE_SIZE);
    expect(npc.height).toBe(TILE_SIZE);
    expect(npc.attackRange).toBe(TILE_SIZE);
  });

  it('rejects a zero or non-finite box rather than drawing nothing', async () => {
    const npc = await runtime({
      width: 0,
      height: Number.NaN,
      attackRange: -1,
    });

    expect(npc.width).toBe(TILE_SIZE);
    expect(npc.height).toBe(TILE_SIZE);
    expect(npc.attackRange).toBe(TILE_SIZE);
  });

  it('places the instance on the tile that spawned it', async () => {
    const npc = await runtime({});

    expect(npc.position).toEqual({ x: TILE_SIZE, y: 0 });
  });
});
