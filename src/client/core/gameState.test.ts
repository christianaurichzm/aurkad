import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyMapChunk,
  applyWorldUpdate,
  expectWholeWorld,
  getGameState,
  isMapPending,
  setMapMeta,
  setStaticMap,
} from './gameState';
import {
  CharacterAction,
  Direction,
  type MapMetaClient,
} from '../../shared/types';
import type { WorldUpdatePayload } from '../../shared/wsProtocol';
import { TILE_SIZE } from '../../shared/constants';

const self = {
  id: 'me',
  position: { x: 0, y: 0 },
  direction: Direction.Down,
  action: CharacterAction.Idle,
  health: 100,
};

function update(partial: Partial<WorldUpdatePayload>): WorldUpdatePayload {
  return { entities: {}, leave: [], self, ...partial };
}

const otherPlayer = {
  id: 'p2',
  name: 'Bob',
  kind: 'player',
  position: { x: 10, y: 10 },
  health: 80,
};

beforeEach(() => {
  setStaticMap({
    id: '1',
    name: 'M',
    type: 'normal',
    tiles: [[{ tileIndex: 0 }]],
  });
  setMapMeta({ id: '1', name: 'M', type: 'normal', cols: 1, rows: 1 } as never);
  setStaticMap({
    id: '1',
    name: 'M',
    type: 'normal',
    tiles: [[{ tileIndex: 0 }]],
  });
  applyWorldUpdate(update({}));
});

describe('getGameState', () => {
  // The HUD marks a PvP map by it, and the pack sets it apart from `type`.
  it("keeps the map's PvP morale from its meta", () => {
    setMapMeta({
      id: '2',
      name: 'Arena',
      type: 'normal',
      pvp: 'normal',
      cols: 1,
      rows: 1,
    } as never);
    applyWorldUpdate(update({}));

    expect(getGameState()?.pvp).toBe('normal');
  });
});

describe('applyWorldUpdate', () => {
  it('inserts an unknown entity, routing it by kind', () => {
    applyWorldUpdate(
      update({
        entities: {
          p2: otherPlayer as never,
          n1: { id: 'n1', name: 'Rat', kind: 'npc', health: 5 } as never,
        },
      }),
    );

    const state = getGameState()!;
    expect(state.players['p2'].name).toBe('Bob');
    expect(state.npcs['n1'].name).toBe('Rat');
  });

  it('merges a partial update into a known entity without losing fields', () => {
    applyWorldUpdate(update({ entities: { p2: otherPlayer as never } }));
    applyWorldUpdate(update({ entities: { p2: { health: 30 } as never } }));

    const bob = getGameState()!.players['p2'];
    expect(bob.health).toBe(30);
    expect(bob.name).toBe('Bob'); // untouched field survives the merge
    expect(bob.position).toEqual({ x: 10, y: 10 });
  });

  it('drops entities listed in leave', () => {
    applyWorldUpdate(update({ entities: { p2: otherPlayer as never } }));
    applyWorldUpdate(update({ leave: ['p2'] }));

    expect(getGameState()!.players['p2']).toBeUndefined();
  });

  it('starts over on the first update from a new socket, then merges again', () => {
    const carol = { ...otherPlayer, id: 'p3', name: 'Carol' };
    applyWorldUpdate(update({ entities: { p2: otherPlayer as never } }));

    // Bob left while the socket was down; nobody will ever send his leave.
    expectWholeWorld();
    applyWorldUpdate(update({ entities: { p3: carol as never } }));
    expect(getGameState()!.players['p2']).toBeUndefined();
    expect(getGameState()!.players['p3']?.name).toBe('Carol');

    applyWorldUpdate(update({ entities: { p3: { health: 1 } as never } }));
    expect(getGameState()!.players['p3']?.name).toBe('Carol');
  });

  it('produces a fresh map reference so the composed cache invalidates', () => {
    // getGameState() caches by object identity; merging in place without a new
    // reference would freeze the rendered frame.
    const before = getGameState();
    applyWorldUpdate(update({ entities: { p2: otherPlayer as never } }));
    expect(getGameState()).not.toBe(before);
  });

  it('keeps droppedItems when the update omits them', () => {
    const drops = [
      { itemId: 1, position: { x: 1, y: 1 }, sprite: 0, quantity: 1 },
    ];
    applyWorldUpdate(update({ droppedItems: drops }));
    expect(getGameState()!.droppedItems).toEqual(drops);

    applyWorldUpdate(update({}));
    expect(getGameState()!.droppedItems).toEqual(drops);
  });

  it('replaces droppedItems when the update carries them', () => {
    applyWorldUpdate(
      update({
        droppedItems: [
          { itemId: 1, position: { x: 1, y: 1 }, sprite: 0, quantity: 1 },
        ],
      }),
    );
    applyWorldUpdate(update({ droppedItems: [] }));
    expect(getGameState()!.droppedItems).toEqual([]);
  });
});

// A map arrives as metadata first and tiles later, a chunk at a time, so
// the renderer covers it until the player's chunk lands.
const meta = (id: string, revision = 1): MapMetaClient => ({
  id,
  name: id,
  type: 'normal',
  cols: 32,
  rows: 32,
  revision,
});

const chunk = (
  mapId: string,
  chunkX: number,
  chunkY: number,
  revision = 1,
) => ({
  mapId,
  revision,
  chunkX,
  chunkY,
  tiles: [[{ tileIndex: 5, blocked: false }]],
});

describe('a map that is still arriving', () => {
  it('ignores chunks from the previous map and a previous revision', () => {
    setMapMeta(meta('stale-chunks', 2));
    applyMapChunk(chunk('1', 0, 0, 2));
    applyMapChunk(chunk('stale-chunks', 0, 0, 1));

    expect(isMapPending()).toBe(true);
    expect(getGameState()?.tiles[0]?.[0]?.tileIndex).toBe(-1);

    applyMapChunk(chunk('stale-chunks', 0, 0, 2));
    expect(isMapPending()).toBe(false);
    expect(getGameState()?.tiles[0]?.[0]?.tileIndex).toBe(5);
  });

  it('does not count repeated chunks toward the fallback that lifts the cover', () => {
    setMapMeta(meta('repeated-chunks'));
    for (let i = 0; i < 4; i++) applyMapChunk(chunk('repeated-chunks', 1, 1));

    expect(isMapPending()).toBe(true);
    applyMapChunk(chunk('repeated-chunks', 0, 0));
    expect(isMapPending()).toBe(false);
  });

  it('lifts the cover over a legitimately empty tile', () => {
    setMapMeta(meta('empty-tile'));
    applyMapChunk({
      ...chunk('empty-tile', 0, 0),
      tiles: [[{ tileIndex: -1 }]],
    });

    expect(isMapPending()).toBe(false);
    expect(getGameState()?.tiles[0]?.[0]?.tileIndex).toBe(-1);
  });

  it('waits for fresh tiles when a cached map has a new revision', () => {
    setMapMeta(meta('revised-map'));
    applyMapChunk(chunk('revised-map', 0, 0));
    setMapMeta(meta('another-map'));
    setMapMeta(meta('revised-map', 2));

    expect(isMapPending()).toBe(true);
    expect(getGameState()?.tiles[0]?.[0]?.tileIndex).toBe(-1);
    applyMapChunk(chunk('revised-map', 0, 0));
    expect(isMapPending()).toBe(true);
    applyMapChunk(chunk('revised-map', 0, 0, 2));
    expect(isMapPending()).toBe(false);
  });

  it('lifts the cover when the new position arrives after its chunk', () => {
    applyWorldUpdate(
      update({
        self: { ...self, position: { x: 40 * TILE_SIZE, y: 30 * TILE_SIZE } },
      }),
    );
    setMapMeta({ ...meta('small'), cols: 10, rows: 10 });
    applyMapChunk(chunk('small', 0, 0));

    applyWorldUpdate(
      update({
        self: { ...self, position: { x: 9 * TILE_SIZE, y: 9 * TILE_SIZE } },
      }),
    );

    expect(isMapPending()).toBe(false);
  });

  it('keeps waiting when an update arrives before the chunk under the player', () => {
    applyWorldUpdate(
      update({
        self: { ...self, position: { x: 20 * TILE_SIZE, y: 20 * TILE_SIZE } },
      }),
    );
    setMapMeta(meta('late-chunk'));
    applyMapChunk(chunk('late-chunk', 0, 0));
    applyWorldUpdate(
      update({
        self: { ...self, position: { x: 20 * TILE_SIZE, y: 20 * TILE_SIZE } },
      }),
    );

    expect(isMapPending()).toBe(true);
    applyMapChunk(chunk('late-chunk', 1, 1));
    expect(isMapPending()).toBe(false);
  });

  it('waits for the chunk the player is standing in', () => {
    setMapMeta(meta('A'));
    expect(isMapPending()).toBe(true);

    // A corner of the map, nowhere near the player at (0,0).
    applyMapChunk(chunk('A', 1, 1));
    expect(isMapPending()).toBe(true);

    applyMapChunk(chunk('A', 0, 0));
    expect(isMapPending()).toBe(false);
  });

  it('is not pending at all for a map still in hand', () => {
    setMapMeta(meta('A'));
    applyMapChunk(chunk('A', 0, 0));
    setMapMeta(meta('B'));
    expect(isMapPending()).toBe(true);

    // Back through the same door: the tiles are on screen in the frame the
    // player arrives, so there is nothing to cover.
    setMapMeta(meta('A'));

    expect(isMapPending()).toBe(false);
    expect(getGameState()?.tiles[0]?.[0]?.tileIndex).toBe(5);
  });

  // A revision counts from the server's boot: after a restart the same id
  // and revision can describe a map resized while it was down.
  it('takes the size from the meta when id and revision repeat', () => {
    setMapMeta(meta('resized'));
    applyMapChunk(chunk('resized', 0, 0));
    setMapMeta({ ...meta('resized'), cols: 64, rows: 48 });

    expect(getGameState()?.tiles).toHaveLength(48);
    expect(getGameState()?.tiles[0]).toHaveLength(64);

    setMapMeta(meta('elsewhere'));
    setMapMeta(meta('resized'));
    expect(getGameState()?.tiles).toHaveLength(32);
  });

  // After a map change the server inserts everything in view and names
  // nobody as leaving, so old entities must be dropped here.
  it("leaves the old map's entities behind with it", () => {
    applyWorldUpdate(update({ entities: { p2: otherPlayer as never } }));
    expect(getGameState()!.players['p2']).toBeDefined();

    setMapMeta(meta('B'));

    expect(getGameState()!.players).toEqual({});
    expect(getGameState()!.id).toBe('B');
  });

  it('keeps three maps, not the whole tour', () => {
    setMapMeta(meta('A'));
    applyMapChunk(chunk('A', 0, 0));
    for (const id of ['B', 'C', 'D', 'E']) setMapMeta(meta(id));

    setMapMeta(meta('A'));

    expect(isMapPending()).toBe(true);
  });
});
