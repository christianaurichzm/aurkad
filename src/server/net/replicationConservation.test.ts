import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { broadcastGameState, resetPlayerNetState } from './snapshot.js';
import { resetEntityReplication, slotCapacity } from './entityReplication.js';
import { spawnNpc, despawnNpc } from '../services/npc/spawn.js';
import { playersWsMap } from './connections.js';
import { createFixture, tile } from '../sim/simFixture.js';
import { rebuildQuadtree } from '../sim/spatialManager.js';
import { toPlayerPublic, toNpcPublic } from './serialization.js';
import { queryEntitiesInRect } from '../sim/spatialManager.js';
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
  const socket = {
    readyState: WebSocket.OPEN,
    bufferedAmount: 0,
    send: (data: string) => sent.push(data),
  };
  return {
    ws: socket as unknown as WebSocket,
    /** Drives the backpressure path, which is how a viewer misses a tick. */
    setBuffered(bytes: number) {
      socket.bufferedAmount = bytes;
    },
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

  // The interest set is indexed by recycled slots, so an entity taking over
  // a despawned one's slot could pass as known to a viewer that never saw it,
  // and its predecessor never be reported gone.
  it('does not let an entity inherit the slot of the one it replaced', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice', position: tile(2, 2) });
    resetPlayerNetState('Alice');

    const { ws, worldUpdates } = collectingWs();
    playersWsMap.set('Alice', ws);
    const client = makeClient();

    const first = spawnNpc({ mapId: sim.mapId, col: 3, row: 3 })!;
    rebuildQuadtree(sim.mapId, sim.map);
    broadcastGameState();
    for (const p of worldUpdates()) client.apply(p);
    expect(client.npcs[first.id]).toBeDefined();

    const capacityWithFirst = slotCapacity();
    despawnNpc(first);
    const second = spawnNpc({ mapId: sim.mapId, col: 3, row: 3 })!;

    rebuildQuadtree(sim.mapId, sim.map);
    broadcastGameState();
    for (const p of worldUpdates()) client.apply(p);

    // Without this the test would be vacuous: it only exercises recycling if
    // the replacement actually took the freed slot instead of a fresh one.
    expect(slotCapacity()).toBe(capacityWithFirst);
    expect(second.id).not.toBe(first.id);

    // The replacement arrived complete, not as a delta against its predecessor.
    const truth = serverTruth(sim.map, alice);
    expect(client.npcs[second.id]).toEqual(truth.npcs[second.id]);
    // And the one it replaced was retired rather than silently overwritten.
    expect(client.npcs[first.id]).toBeUndefined();
  });

  // A fragment's delta is shared and covers one tick, so a viewer not served
  // on some tick cannot just get the next delta: what it slept through is in
  // neither. Backpressure does this by accident, cadence by design.
  it('does not lose changes a viewer slept through', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice', position: tile(2, 2) });
    const bob = sim.addPlayer({ name: 'Bob', position: tile(4, 2) });
    resetPlayerNetState('Alice');

    const { ws, setBuffered, worldUpdates } = collectingWs();
    playersWsMap.set('Alice', ws);
    const client = makeClient();

    rebuildQuadtree(sim.mapId, sim.map);
    broadcastGameState();
    for (const p of worldUpdates()) client.apply(p);
    expect(client.players[bob.id]!.position).toEqual(tile(4, 2));

    // Alice is congested for exactly one tick, and Bob moves during it.
    setBuffered(config.ws.maxBufferedBytes + 1);
    bob.position = tile(5, 2);
    rebuildQuadtree(sim.mapId, sim.map);
    broadcastGameState();

    // Next tick Bob holds still, so the shared fragment has no delta to carry
    // the move Alice missed. She has to be brought up to date some other way.
    setBuffered(0);
    rebuildQuadtree(sim.mapId, sim.map);
    broadcastGameState();
    for (const p of worldUpdates()) client.apply(p);

    expect(client.players[bob.id]!.position).toEqual(tile(5, 2));
    expect(client.players[bob.id]).toEqual(
      serverTruth(sim.map, alice).players[bob.id],
    );
  });

  // Same claim as the first test in this file, but with the viewer served on
  // half the ticks: what it is not told about has to reach it later, and an
  // entity that came and went entirely inside a skipped tick must not linger.
  it('conserves state when the viewer is served on a cadence', () => {
    const net = config.net as { viewerCadenceTicks: number };
    const before = net.viewerCadenceTicks;
    net.viewerCadenceTicks = 2;

    try {
      const sim = createFixture(0);
      const alice = sim.addPlayer({ name: 'Alice', position: tile(2, 2) });
      const bob = sim.addPlayer({ name: 'Bob', position: tile(4, 2) });
      const roamer = sim.addPlayer({ name: 'Roamer', position: tile(60, 60) });
      sim.addNpc({ position: tile(3, 3) });
      resetPlayerNetState('Alice');

      const { ws, worldUpdates } = collectingWs();
      playersWsMap.set('Alice', ws);
      const client = makeClient();

      for (let i = 0; i < 12; i++) {
        if (i === 0) sim.press('Bob', Key.ArrowRight);
        if (i === 5) sim.release('Bob', Key.ArrowRight);
        // In and out of view within one cycle, so at least one of the two
        // transitions happens on a tick Alice is not served.
        if (i === 7) roamer.position = tile(3, 2);
        if (i === 8) roamer.position = tile(60, 60);
        sim.step(1);
        for (const payload of worldUpdates()) client.apply(payload);
      }

      const truth = serverTruth(sim.map, alice);

      expect(Object.keys(client.players)).toEqual([bob.id]);
      expect(client.players[bob.id]).toEqual(truth.players[bob.id]);
      for (const [id, npc] of Object.entries(truth.npcs)) {
        expect(client.npcs[id]).toEqual(npc);
      }
      expect(Object.keys(client.npcs).sort()).toEqual(
        Object.keys(truth.npcs).sort(),
      );
    } finally {
      net.viewerCadenceTicks = before;
    }
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
