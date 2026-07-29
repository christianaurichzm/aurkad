import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { broadcastGameState, resetPlayerNetState } from './snapshot.js';
import { resetEntityReplication } from './entityReplication.js';
import { playersWsMap } from './connections.js';
import { createFixture, tile } from '../sim/simFixture.js';
import { rebuildQuadtree } from '../spatial/spatialManager.js';
import { toPlayerPublic, toNpcPublic } from './serialization.js';
import { queryEntitiesInRect } from '../spatial/spatialManager.js';
import { calcViewport, type Viewport } from '../../shared/mapGeometry.js';
import { config } from '../config.js';
import { TILE_SIZE } from '../../shared/constants.js';
import {
  Key,
  type PlayerServer,
  type MapStateServer,
} from '../../shared/types.js';
import type { WorldUpdatePayload } from '../../shared/wsProtocol.js';

// Minimal stand-in for the client's applyWorldUpdate: merge-or-insert by id,
// drop what left. Independent of the client implementation so the
// test pins the PROTOCOL contract, not one particular client.
function makeClient() {
  const players: Record<string, Record<string, unknown>> = {};
  const npcs: Record<string, Record<string, unknown>> = {};
  let droppedItems: unknown[] = [];

  return {
    players,
    npcs,
    get droppedItems() {
      return droppedItems;
    },
    apply(payload: WorldUpdatePayload) {
      for (const [id, patch] of Object.entries(payload.entities ?? {})) {
        const p = patch as Record<string, unknown>;
        const existing = players[id] ?? npcs[id];
        if (existing) {
          // null means the field was cleared (JSON cannot carry undefined).
          for (const [k, v] of Object.entries(p)) {
            if (v === null) delete existing[k];
            else existing[k] = v;
          }
        } else if (p.kind === 'npc') npcs[id] = { ...p };
        else players[id] = { ...p };
      }
      for (const id of payload.leave ?? []) {
        delete players[id];
        delete npcs[id];
      }
      if (payload.droppedItems) droppedItems = payload.droppedItems;
    },
  };
}

function collectingWs() {
  const sent: string[] = [];
  return {
    ws: {
      readyState: WebSocket.OPEN,
      bufferedAmount: 0,
      send: (data: string) => sent.push(data),
    } as unknown as WebSocket,
    worldUpdates(): WorldUpdatePayload[] {
      return sent
        .map((s) => JSON.parse(s))
        .filter((m) => m.type === 'worldUpdate')
        .map((m) => m.payload as WorldUpdatePayload);
    },
  };
}

// What a whole-tree snapshot of the viewer's view would hold: the ground
// truth the client must end up agreeing with.
function serverTruth(map: MapStateServer, viewer: PlayerServer) {
  const viewport = calcViewport(
    viewer.position.x,
    viewer.position.y,
    map.tiles,
    config.net.aoiMarginTiles * TILE_SIZE,
  );
  return serverView(map, viewer, viewport);
}

/**
 * What the viewer should be able to see, computed apart from the snapshot
 * code under test. An oracle for this test, not something the server sends:
 * the wire streams map metadata and tile chunks instead.
 */
function serverView(
  map: MapStateServer,
  viewer: PlayerServer,
  viewport: Viewport,
) {
  const nearby = queryEntitiesInRect(map.id, {
    x: viewport.left,
    y: viewport.top,
    width: viewport.right - viewport.left,
    height: viewport.bottom - viewport.top,
  });

  const players: Record<string, unknown> = {};
  const npcs: Record<string, unknown> = {};

  for (const entity of nearby) {
    if (!entity.id) continue;
    if (entity.kind === 'player') {
      // The viewer's own state travels in `self`, not in `entities`.
      if (entity.id === viewer.id) continue;
      const other = map.players[entity.id];
      if (other) players[entity.id] = toPlayerPublic(other);
    } else if (entity.kind === 'npc') {
      const npc = map.npcs[entity.id];
      if (npc) npcs[entity.id] = toNpcPublic(npc);
    }
  }

  const droppedItems = map.droppedItems.filter(
    (item) =>
      item.position.x >= viewport.left &&
      item.position.x <= viewport.right &&
      item.position.y >= viewport.top &&
      item.position.y <= viewport.bottom,
  );

  return { id: map.id, droppedItems, npcs, players };
}

afterEach(() => {
  playersWsMap.clear();
  resetEntityReplication();
});

describe('entity replication conserves state', () => {
  it('a client applying the updates ends up matching the server view', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice', position: tile(2, 2) });
    const bob = sim.addPlayer({ name: 'Bob', position: tile(4, 2) });
    sim.addNpc({ position: tile(3, 3) });
    resetPlayerNetState('Alice');

    const { ws, worldUpdates } = collectingWs();
    playersWsMap.set('Alice', ws);
    const client = makeClient();

    // Drive several ticks with Bob walking, applying every update as it goes.
    for (let i = 0; i < 12; i++) {
      if (i === 0) sim.press('Bob', Key.ArrowRight);
      if (i === 6) sim.release('Bob', Key.ArrowRight);
      sim.step(1);
      rebuildQuadtree(sim.mapId, sim.map);
      broadcastGameState();
      for (const payload of worldUpdates()) client.apply(payload);
    }

    const truth = serverTruth(sim.map, alice);

    // Bob must be present client-side and field-for-field identical.
    expect(Object.keys(client.players)).toEqual([bob.id]);
    expect(client.players[bob.id]).toEqual(truth.players[bob.id]);

    // Same for every NPC in view.
    for (const [id, npc] of Object.entries(truth.npcs)) {
      expect(client.npcs[id]).toEqual(npc);
    }
    expect(Object.keys(client.npcs).sort()).toEqual(
      Object.keys(truth.npcs).sort(),
    );
  });

  it('sends a full state when an entity enters and a tombstone when it leaves', () => {
    const sim = createFixture(0);
    sim.addPlayer({ name: 'Alice', position: tile(2, 2) });
    // Far outside Alice's viewport to begin with.
    const far = sim.addPlayer({ name: 'Far', position: tile(60, 60) });
    resetPlayerNetState('Alice');

    const { ws, worldUpdates } = collectingWs();
    playersWsMap.set('Alice', ws);
    const client = makeClient();

    rebuildQuadtree(sim.mapId, sim.map);
    broadcastGameState();
    for (const p of worldUpdates()) client.apply(p);
    expect(client.players[far.id]).toBeUndefined();

    // Teleport it next to Alice: the first update carrying it must be complete,
    // otherwise the client would insert a half-built entity.
    far.position = tile(3, 2);
    rebuildQuadtree(sim.mapId, sim.map);
    broadcastGameState();
    for (const p of worldUpdates()) client.apply(p);

    const entered = client.players[far.id]!;
    expect(entered).toBeDefined();
    expect(entered.id).toBe(far.id);
    expect(entered.name).toBe('Far');
    expect(entered.position).toEqual(tile(3, 2));

    // Move it away again: the client must be told to drop it.
    far.position = tile(60, 60);
    rebuildQuadtree(sim.mapId, sim.map);
    broadcastGameState();
    for (const p of worldUpdates()) client.apply(p);

    expect(client.players[far.id]).toBeUndefined();
  });

  it('goes silent when nothing in the world changed', () => {
    const sim = createFixture(0);
    sim.addPlayer({ name: 'Alice', position: tile(2, 2) });
    sim.addPlayer({ name: 'Still', position: tile(3, 2) });
    resetPlayerNetState('Alice');

    const { ws, worldUpdates } = collectingWs();
    playersWsMap.set('Alice', ws);

    rebuildQuadtree(sim.mapId, sim.map);
    broadcastGameState();
    const afterFirst = worldUpdates();
    expect(afterFirst).toHaveLength(1);
    expect(Object.keys(afterFirst[0]!.entities)).toHaveLength(1);

    // Nothing moved between these two ticks: no second message at all.
    rebuildQuadtree(sim.mapId, sim.map);
    broadcastGameState();
    expect(worldUpdates()).toHaveLength(1);
  });

  it('still sends the viewer its own state when it is alone and moving', () => {
    // The viewer is not in `entities`, so a solo player would otherwise get
    // nothing and never reconcile its prediction.
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice', position: tile(2, 2) });
    resetPlayerNetState('Alice');

    const { ws, worldUpdates } = collectingWs();
    playersWsMap.set('Alice', ws);

    rebuildQuadtree(sim.mapId, sim.map);
    broadcastGameState();
    const before = worldUpdates().length;

    alice.position = tile(3, 2);
    rebuildQuadtree(sim.mapId, sim.map);
    broadcastGameState();

    const updates = worldUpdates();
    expect(updates.length).toBeGreaterThan(before);
    expect(updates.at(-1)!.self.position).toEqual(tile(3, 2));
  });

  it('propagates dropped items to the viewer', () => {
    const sim = createFixture(0);
    sim.addPlayer({ name: 'Alice', position: tile(2, 2) });
    resetPlayerNetState('Alice');

    const { ws, worldUpdates } = collectingWs();
    playersWsMap.set('Alice', ws);
    const client = makeClient();

    sim.map.droppedItems.push({
      itemId: 1,
      position: tile(2, 3),
      sprite: 0,
      quantity: 2,
    });

    rebuildQuadtree(sim.mapId, sim.map);
    broadcastGameState();
    for (const p of worldUpdates()) client.apply(p);

    expect(client.droppedItems).toEqual([
      { itemId: 1, position: tile(2, 3), sprite: 0, quantity: 2 },
    ]);
  });
});

describe('protocol envelope', () => {
  it('stamps every game-state message with the protocol version', async () => {
    const { PROTOCOL_VERSION } = await import('../../shared/wsProtocol.js');
    const sim = createFixture(0);
    sim.addPlayer({ name: 'Alice', position: tile(2, 2) });
    resetPlayerNetState('Alice');

    const sent: string[] = [];
    playersWsMap.set('Alice', {
      readyState: WebSocket.OPEN,
      bufferedAmount: 0,
      send: (d: string) => sent.push(d),
    } as unknown as WebSocket);

    rebuildQuadtree(sim.mapId, sim.map);
    broadcastGameState();

    expect(sent.length).toBeGreaterThan(0);
    for (const raw of sent) {
      expect(JSON.parse(raw).v).toBe(PROTOCOL_VERSION);
    }
  });
});
