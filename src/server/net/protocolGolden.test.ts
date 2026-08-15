/**
 * The server->client wire format, frozen byte for byte. Snapshots reach the
 * client through `JSON.stringify` and hand-built strings, so a field added
 * to `PlayerPublic`, a new key or a reordered literal changes what every
 * client receives, and a round-trip test would change on both sides. The
 * steps must match the labels in the goldens fixture, which the client
 * decodes in its own test.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import WebSocket from 'ws';
import { broadcastGameState, resetPlayerNetState } from './snapshot.js';
import { resetEntityReplication } from './entityReplication.js';
import { playersWsMap } from './connections.js';
import { createFixture, tile, makeTiles } from '../sim/simFixture.js';
import { rebuildQuadtree } from '../spatial/spatialManager.js';
import { items } from '../services/world/gameData.js';
import { PROTOCOL_VERSION } from '../../shared/wsProtocol.js';
import { PROTOCOL_GOLDEN_STEPS } from '../../shared/testFixtures/wsProtocolGoldens.js';
import { CharacterAction, Direction, type Item } from '../../shared/types.js';

afterEach(() => {
  playersWsMap.clear();
  resetPlayerNetState('Alice');
  resetPlayerNetState('Bob');
  resetEntityReplication();
});

/**
 * Replays the scripted session and returns the frames the viewer received,
 * grouped per step in the same order as the goldens.
 */
function replayScenario(): Array<{ label: string; messages: string[] }> {
  resetEntityReplication();
  resetPlayerNetState('Alice');
  resetPlayerNetState('Bob');

  const sim = createFixture(0);
  sim.map.tiles = makeTiles(2, 2);
  items.set(1, {
    id: 1,
    name: 'Potion',
    sprite: 4,
    type: 'consumable',
  } as Item);

  const alice = sim.addPlayer({
    id: 'alice',
    name: 'Alice',
    position: tile(0, 0),
    inventory: { items: [{ item: 1, quantity: 3 }], maxCapacity: 10 },
  });
  sim.addPlayer({ id: 'bob', name: 'Bob', position: tile(1, 0) });
  sim.addNpc({ id: 'npc1', name: 'Goblin', position: tile(1, 1) });

  const received: string[] = [];
  const viewer = {
    readyState: WebSocket.OPEN,
    bufferedAmount: 0,
    send: vi.fn((data: string) => void received.push(data)),
  };
  playersWsMap.set('Alice', viewer as unknown as WebSocket);
  // Bob is connected too, so the fragment cache is genuinely shared between two
  // viewers rather than degenerating into a single-viewer path.
  playersWsMap.set('Bob', {
    readyState: WebSocket.OPEN,
    bufferedAmount: 0,
    send: vi.fn(),
  } as unknown as WebSocket);

  const steps: Array<{ label: string; messages: string[] }> = [];
  const capture = (label: string, mutate?: () => void) => {
    received.length = 0;
    mutate?.();
    rebuildQuadtree(sim.mapId, sim.map);
    broadcastGameState();
    steps.push({ label, messages: [...received] });
  };

  const bob = sim.getPlayer('Bob');

  capture('first tick');
  capture('viewer moves', () => {
    alice.position = tile(0, 1);
    alice.direction = Direction.Down;
    alice.action = CharacterAction.Walk;
  });
  capture('idle tick');
  capture('bob gains a targetPosition', () => {
    bob.targetPosition = { x: 64, y: 64 };
  });
  capture('bob clears its targetPosition', () => {
    bob.targetPosition = undefined;
    bob.position = { x: 64, y: 64 };
  });
  capture('bob and the npc leave', () => {
    delete sim.map.players['bob'];
    delete sim.map.npcs['npc1'];
  });

  return steps;
}

describe('protocol version', () => {
  it('is pinned, so a bump is always a deliberate edit', () => {
    // The client force-reloads on mismatch. Changing this without the payloads
    // strands nothing; changing the payloads alone lets a stale tab misread
    // them, which is what this guards.
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it('stamps every game-state frame', () => {
    for (const step of replayScenario()) {
      for (const message of step.messages) {
        expect(JSON.parse(message).v).toBe(PROTOCOL_VERSION);
      }
    }
  });
});

describe('server -> client wire format', () => {
  const replayed = replayScenario();

  it('emits the same steps the goldens describe', () => {
    expect(replayed.map((s) => s.label)).toEqual(
      PROTOCOL_GOLDEN_STEPS.map((s) => s.label),
    );
  });

  for (const [index, golden] of PROTOCOL_GOLDEN_STEPS.entries()) {
    it(`encodes "${golden.label}" byte for byte`, () => {
      expect(replayed[index]!.messages).toEqual(golden.messages);
    });
  }
});
