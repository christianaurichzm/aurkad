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
import { CharacterAction, Direction } from '../../shared/types';
import type { WorldUpdatePayload } from '../../shared/wsProtocol';

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
const meta = (id: string, revision = 1) =>
  ({
    id,
    name: id,
    type: 'normal',
    cols: 32,
    rows: 32,
    revision,
  }) as never;

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
