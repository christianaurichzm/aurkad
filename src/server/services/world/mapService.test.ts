import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TILE_SIZE } from '../../../shared/constants.js';
import type {
  MapStateServer,
  PersistentNpc,
  Tile,
} from '../../../shared/types.js';
import { createFixture, makeTiles, tile } from '../../sim/simFixture.js';
import { updateMapById } from './mapService.js';
import { getMap } from '../../sim/world.js';

const getNpcById = vi.fn();
vi.mock('../content/npcService.js', () => ({
  getNpcById: (id: string) => getNpcById(id),
}));

vi.mock('../../persistence/mapRepository.js', () => ({
  mapRepository: { upsert: vi.fn() },
}));

const { insertNpcs, createOrUpdateMap, mapSave } =
  await import('./mapService.js');
const { on } = await import('../../engine/hooks.js');
const { runtimeState } = await import('../../sim/state.js');
const { spawnNpc } = await import('../npc/spawn.js');
const { respawnNpc } = await import('../npc/index.js');
const { msToTicks } = await import('../../sim/clock.js');

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

describe('the mapChange hook', () => {
  it('fires when the tiles change, with the live map already holding them', async () => {
    const seen: (number | undefined)[] = [];
    const stop = on('mapChange', ({ mapId }) =>
      seen.push(runtimeState.maps[mapId]?.tiles[0]?.[0]?.maskIndex),
    );
    await createOrUpdateMap({
      id: 'yard',
      tiles: [[{ tileIndex: 0, maskIndex: 7 }]],
    });
    await createOrUpdateMap({ id: 'yard', name: 'The yard' });
    stop();

    expect(seen).toEqual([7]);
  });
});

describe('editing a populated map', () => {
  it('keeps an in-bounds step running when a tile edit leaves room for it', async () => {
    const sim = createFixture();
    const alice = sim.addPlayer({
      position: tile(1, 1),
      moving: true,
      targetPosition: tile(2, 1),
      moveTick: 1,
      moveDurationTicks: 5,
    });

    await createOrUpdateMap({ id: sim.mapId, tiles: makeTiles(3, 4) });

    expect(alice.position).toEqual(tile(1, 1));
    expect(alice.targetPosition).toEqual(tile(2, 1));
    expect(alice.moving).toBe(true);
    expect(alice.moveTick).toBe(1);
    expect(alice.moveDurationTicks).toBe(5);
  });

  it('retains the live roster when an update comes from a stored map document', async () => {
    const sim = createFixture();
    const alice = sim.addPlayer({ name: 'Alice', position: tile(5, 5) });
    const npc = sim.addNpc({ position: tile(2, 2) });
    const document = {
      id: sim.mapId,
      name: 'Renamed',
      type: 'normal',
      tiles: makeTiles(20, 20),
      droppedItems: [],
    } as unknown as MapStateServer;

    await updateMapById(document);

    const live = getMap(sim.mapId)!;
    expect(live.players[alice.id]).toBe(alice);
    expect(live.npcs[npc.id]).toBe(npc);
    expect(alice.position).toEqual(tile(5, 5));
  });

  it.each([
    {
      label: 'standing outside',
      position: tile(19, 19),
      targetPosition: tile(18, 19),
    },
    {
      label: 'stepping outside',
      position: tile(3, 2),
      targetPosition: tile(4, 2),
    },
  ])(
    'moves players $label onto a shrunken map and cancels a step toward deleted tiles',
    async ({ position, targetPosition }) => {
      const sim = createFixture();
      const alice = sim.addPlayer({
        name: 'Alice',
        position,
        moving: true,
        targetPosition,
        moveTick: 1,
        moveDurationTicks: 5,
      });
      const joinedPositions: unknown[] = [];
      const stop = on('mapChange', () =>
        joinedPositions.push({ ...alice.position }),
      );
      try {
        await createOrUpdateMap({ id: sim.mapId, tiles: makeTiles(3, 4) });

        expect(alice.position).toEqual(tile(3, 2));
        expect(alice.moving).toBe(false);
        expect(alice.targetPosition).toBeUndefined();
        expect(alice.moveTick).toBeUndefined();
        expect(alice.moveDurationTicks).toBeUndefined();
        expect(joinedPositions).toEqual([tile(3, 2)]);
        expect(getMap(sim.mapId)?.players[alice.id]).toBe(alice);
      } finally {
        stop();
      }
    },
  );
});

// The editor sends the whole grid on every save, so the save has to tell what
// the edit changed from what the players changed since the map loaded.
describe('saving a map from the editor while it is played', () => {
  const wolf: Partial<PersistentNpc> = {
    id: 'wolf',
    name: 'Wolf',
    sprite: 3,
    maxHealth: 50,
    attack: 4,
    behavior: 'aggressive',
    respawnMs: 60_000,
  };

  const grid = (
    size: number,
    spawns: Array<[number, number]> = [],
    placed: Array<[number, number, number]> = [],
  ): Tile[][] => {
    const tiles = makeTiles(size, size);
    for (const [col, row] of spawns) tiles[row]![col]!.npcSpawn = 'wolf';
    for (const [col, row, item] of placed) tiles[row]![col]!.item = item;
    return tiles;
  };

  // The map as boot leaves it: npcs from spawn tiles, nothing on the ground.
  const loaded = async (tiles: Tile[][]) => {
    const sim = createFixture();
    getNpcById.mockResolvedValue(wolf);
    sim.map.tiles = tiles;
    await insertNpcs(sim.map, sim.mapId, tiles);
    return sim;
  };

  const save = (mapId: string, tiles: Tile[][]) =>
    mapSave(mapId, tiles, 'Test', 'normal');

  it('leaves what players dropped on the ground', async () => {
    const sim = await loaded(grid(10));
    const drop = {
      itemId: 7,
      sprite: 1,
      quantity: 3,
      position: tile(4, 4),
      expiresAtTick: 600,
    };
    sim.map.droppedItems.push(drop);

    await save(sim.mapId, grid(10));

    expect(getMap(sim.mapId)!.droppedItems).toEqual([drop]);
  });

  it('keeps a wounded npc where the fight left it', async () => {
    const sim = await loaded(grid(10, [[2, 2]]));
    const npc = Object.values(sim.map.npcs)[0]!;
    npc.health = 12;
    npc.position = tile(5, 6);

    await save(sim.mapId, grid(10, [[2, 2]]));

    expect(getMap(sim.mapId)!.npcs[npc.id]).toBe(npc);
    expect(npc.health).toBe(12);
    expect(npc.position).toEqual(tile(5, 6));
  });

  it('keeps the npcs a script spawned', async () => {
    const sim = await loaded(grid(10));
    const cat = spawnNpc({ mapId: sim.mapId, col: 3, row: 3, name: 'Cat' })!;

    await save(sim.mapId, grid(10));

    expect(getMap(sim.mapId)!.npcs[cat.id]).toBe(cat);
  });

  it('adds the npc of a new spawn and takes away the one whose spawn went', async () => {
    const sim = await loaded(grid(10, [[2, 2]]));
    const old = Object.values(sim.map.npcs)[0]!;

    await save(sim.mapId, grid(10, [[7, 7]]));

    const npcs = Object.values(getMap(sim.mapId)!.npcs);
    expect(npcs).not.toContain(old);
    expect(npcs.map((n) => n.position)).toEqual([tile(7, 7)]);
  });

  it('leaves a killed npc to its respawn instead of raising it', async () => {
    const sim = await loaded(grid(10, [[2, 2]]));
    const npc = Object.values(sim.map.npcs)[0]!;
    respawnNpc(sim.mapId, npc);

    await save(sim.mapId, grid(10, [[2, 2]]));
    expect(getMap(sim.mapId)!.npcs).toEqual({});

    sim.step(msToTicks(60_000) + 1);
    expect(getMap(sim.mapId)!.npcs[npc.id]).toBe(npc);
  });

  it('puts an item placed in the editor on the ground once', async () => {
    const sim = await loaded(grid(10));
    sim.addItem({
      id: 9,
      name: 'Potion',
      description: '',
      sprite: 2,
      type: 'consumable',
    });

    await save(sim.mapId, grid(10, [], [[4, 4, 9]]));
    expect(getMap(sim.mapId)!.droppedItems).toEqual([
      { itemId: 9, sprite: 2, quantity: 1, position: tile(4, 4) },
    ]);

    // Picked up, then the map is saved again for something else.
    getMap(sim.mapId)!.droppedItems.length = 0;
    await save(sim.mapId, grid(10, [], [[4, 4, 9]]));
    expect(getMap(sim.mapId)!.droppedItems).toEqual([]);
  });

  it('moves what stood on the removed tiles of a shrunken map onto it', async () => {
    const sim = await loaded(grid(10, [[1, 1]]));
    const npc = Object.values(sim.map.npcs)[0]!;
    npc.position = tile(8, 8);
    const cat = spawnNpc({ mapId: sim.mapId, col: 9, row: 2, name: 'Cat' })!;
    sim.map.droppedItems.push({
      itemId: 7,
      sprite: 1,
      quantity: 1,
      position: tile(9, 9),
    });

    await save(sim.mapId, grid(4, [[1, 1]]));

    const live = getMap(sim.mapId)!;
    expect(live.npcs[npc.id]?.position).toEqual(tile(3, 3));
    expect(live.npcs[cat.id]?.position).toEqual(tile(3, 2));
    expect(live.droppedItems.map((d) => d.position)).toEqual([tile(3, 3)]);
  });
});
