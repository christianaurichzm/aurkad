import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyWorldUpdate,
  getGameState,
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
    tiles: [[{ tileIndex: 0, blocked: false }]],
  });
  setMapMeta({ id: '1', name: 'M', type: 'normal', cols: 1, rows: 1 } as never);
  setStaticMap({
    id: '1',
    name: 'M',
    type: 'normal',
    tiles: [[{ tileIndex: 0, blocked: false }]],
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
