import { describe, it, expect, afterEach, vi } from 'vitest';
import WebSocket from 'ws';
import {
  broadcastGameState,
  recordHealthChange,
  resetPlayerNetState,
} from './snapshot.js';
import { resetEntityReplication } from './entityReplication.js';
import { playersWsMap } from './connections.js';
import { config } from '../config.js';
import { createFixture, tile } from '../sim/simFixture.js';
import { rebuildQuadtree } from '../spatial/spatialManager.js';
import {
  createOrUpdateItem,
  deleteItem,
} from '../services/economy/inventoryService.js';
import { items } from '../services/world/gameData.js';
import { setMapTile } from '../services/world/mapService.js';
import ItemModel from '../model/Item.js';
import DeliveryModel from '../model/Delivery.js';
import type { Item, PlayerCold, PlayerServer } from '../../shared/types.js';

function fakeWs(bufferedAmount: number) {
  return {
    readyState: WebSocket.OPEN,
    bufferedAmount,
    send: vi.fn(),
  };
}

// The knob is read straight off the config object, which is const to callers
// and plain to the runtime. Restoring it matters: the module state deciding
// who is due outlives a single test.
function setCadence(ticks: number) {
  (config.net as { viewerCadenceTicks: number }).viewerCadenceTicks = ticks;
}
const DEFAULT_CADENCE = config.net.viewerCadenceTicks;

afterEach(() => {
  playersWsMap.clear();
  resetPlayerNetState('Alice');
  setCadence(DEFAULT_CADENCE);
});

describe('broadcast backpressure', () => {
  it('skips a congested client and sends to a healthy one', () => {
    const sim = createFixture(0);
    sim.addPlayer({ name: 'Alice' });
    rebuildQuadtree(sim.mapId, sim.map);

    const congested = fakeWs(config.ws.maxBufferedBytes + 1);
    playersWsMap.set('Alice', congested as unknown as WebSocket);
    broadcastGameState();
    expect(congested.send).not.toHaveBeenCalled();

    resetPlayerNetState('Alice');
    const healthy = fakeWs(0);
    playersWsMap.set('Alice', healthy as unknown as WebSocket);
    broadcastGameState();
    expect(healthy.send).toHaveBeenCalled();
  });
});

describe('health changes', () => {
  it('reach the viewers that have the spot in view, once', () => {
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice', position: tile(1, 1) });
    rebuildQuadtree(sim.mapId, sim.map);
    const ws = fakeWs(0);
    playersWsMap.set('Alice', ws as unknown as WebSocket);
    broadcastGameState();

    recordHealthChange(alice, -5);
    recordHealthChange({ ...alice, id: 'far', position: tile(500, 500) }, -9);
    broadcastGameState();
    broadcastGameState();

    const changes = ws.send.mock.calls
      .map((c) => JSON.parse(String(c[0])).payload.healthChanges)
      .filter(Boolean);
    expect(changes).toEqual([[{ id: alice.id, ...tile(1, 1), delta: -5 }]]);
  });
});

describe('a tile changed on a live map', () => {
  it('goes out as its chunk alone, once, not as the whole map again', () => {
    const sim = createFixture(0);
    sim.addPlayer({ name: 'Alice', position: tile(1, 1) });
    rebuildQuadtree(sim.mapId, sim.map);
    const ws = fakeWs(0);
    playersWsMap.set('Alice', ws as unknown as WebSocket);
    broadcastGameState();
    broadcastGameState();
    ws.send.mockClear();

    setMapTile(sim.mapId, 3, 2, { tileIndex: 77, blocked: true });
    broadcastGameState();
    broadcastGameState();

    const frames = ws.send.mock.calls.map((c) => JSON.parse(String(c[0])));
    expect(frames.some((f) => f.type === 'mapMeta')).toBe(false);
    const chunks = frames.filter((f) => f.type === 'mapChunk');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].payload).toMatchObject({ chunkX: 0, chunkY: 0 });
    expect(chunks[0].payload.tiles[2][3]).toEqual({ tileIndex: 77 });
  });
});

describe('dropped items', () => {
  it('go out named, for a client that holds no item catalog', () => {
    const sim = createFixture(0);
    sim.addPlayer({ name: 'Alice', position: tile(1, 1) });
    sim.map.droppedItems.push({
      itemId: 7,
      sprite: 4,
      position: tile(1, 1),
      quantity: 2,
    });
    items.set(7, {
      id: 7,
      name: 'Health Potion',
      description: '',
      sprite: 4,
      type: 'consumable',
    });
    rebuildQuadtree(sim.mapId, sim.map);
    const ws = fakeWs(0);
    playersWsMap.set('Alice', ws as unknown as WebSocket);
    try {
      broadcastGameState();
    } finally {
      items.delete(7);
    }

    const [update] = ws.send.mock.calls
      .map((c) => JSON.parse(String(c[0])))
      .filter((m) => m.type === 'worldUpdate');
    expect(update.payload.droppedItems).toEqual([
      {
        itemId: 7,
        sprite: 4,
        position: tile(1, 1),
        quantity: 2,
        name: 'Health Potion',
      },
    ]);
  });
});

describe('viewer cadence', () => {
  // Everyone moves every tick, so `self` alone would earn each viewer an
  // update: what these tests count is the schedule, not whether there was news.
  function crowd(count: number) {
    const sim = createFixture(0);
    const sockets: ReturnType<typeof fakeWs>[] = [];
    const names: string[] = [];
    const people: PlayerServer[] = [];

    for (let i = 0; i < count; i++) {
      const name = `Cadet${i}`;
      names.push(name);
      people.push(
        sim.addPlayer({
          name,
          position: tile(2 + (i % 8), 2 + Math.floor(i / 8)),
        }),
      );
      resetPlayerNetState(name);
      const ws = fakeWs(0);
      sockets.push(ws);
      playersWsMap.set(name, ws as unknown as WebSocket);
    }

    return {
      sim,
      count,
      tick() {
        for (const person of people) person.position.x += 1;
        rebuildQuadtree(sim.mapId, sim.map);
        broadcastGameState();
      },
      /** World updates this viewer has been sent so far. */
      updatesTo(i: number): number {
        return sockets[i]!.send.mock.calls.filter((c) =>
          String(c[0]).includes('"worldUpdate"'),
        ).length;
      },
      cleanup() {
        for (const name of names) resetPlayerNetState(name);
      },
    };
  }

  afterEach(() => {
    resetEntityReplication();
  });

  it('serves every viewer every tick by default', () => {
    setCadence(1);
    const world = crowd(4);
    for (let t = 0; t < 6; t++) world.tick();

    for (let i = 0; i < world.count; i++) expect(world.updatesTo(i)).toBe(6);
    world.cleanup();
  });

  it('halves the updates at cadence 2 without silencing anyone', () => {
    setCadence(2);
    const world = crowd(4);
    for (let t = 0; t < 8; t++) world.tick();

    // Every viewer is served, and none more often than the cycle allows. The
    // first tick is free for everyone (nobody has been served yet), so over 8
    // ticks a viewer gets that one plus every other one after it.
    for (let i = 0; i < world.count; i++) {
      expect(world.updatesTo(i)).toBeGreaterThanOrEqual(4);
      expect(world.updatesTo(i)).toBeLessThanOrEqual(5);
    }
    world.cleanup();
  });

  // Staggering is the point: the same number of messages all landing on one
  // tick and none on the next would keep the peak this exists to flatten.
  it('spreads viewers across the cycle instead of batching them', () => {
    setCadence(2);
    const world = crowd(8);

    // Burn the free first tick, where everyone is due whatever their phase.
    world.tick();
    const served = Array.from({ length: world.count }, (_, i) =>
      world.updatesTo(i),
    );

    const perTick: number[] = [];
    for (let t = 0; t < 4; t++) {
      world.tick();
      let thisTick = 0;
      for (let i = 0; i < world.count; i++) {
        const now = world.updatesTo(i);
        if (now > served[i]!) thisTick++;
        served[i] = now;
      }
      perTick.push(thisTick);
    }

    expect(perTick).toEqual([4, 4, 4, 4]);
    world.cleanup();
  });

  // Catching a viewer up costs full state, so the saving depends on charging
  // only for what actually moved. Without this the resume tick re-sends every
  // entity on screen and the cadence trades messages for bytes.
  it('does not re-send an entity that stood still while the viewer slept', () => {
    setCadence(2);
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice', position: tile(2, 2) });
    const statue = sim.addPlayer({ name: 'Statue', position: tile(4, 2) });
    resetPlayerNetState('Alice');
    resetPlayerNetState('Statue');

    const ws = fakeWs(0);
    playersWsMap.set('Alice', ws as unknown as WebSocket);
    // Statue has no socket, so only Alice is a viewer here.

    let carryingStatue = 0;
    for (let t = 0; t < 8; t++) {
      alice.position.x += 1;
      rebuildQuadtree(sim.mapId, sim.map);
      broadcastGameState();
      for (const call of ws.send.mock.calls.splice(0)) {
        const message = JSON.parse(String(call[0])) as {
          type: string;
          payload: { entities: Record<string, unknown> };
        };
        if (message.type !== 'worldUpdate') continue;
        if (statue.id in message.payload.entities) carryingStatue++;
      }
    }

    expect(carryingStatue).toBe(1);
    resetPlayerNetState('Statue');
  });

  // Halving the messages only pays if each does not grow to make up for it.
  // Merging an entity's recent changes keeps a cadenced update update-sized;
  // sending the entity whole cost 2.4x the bandwidth of no cadence.
  it('carries merged changes, not the whole entity, to a viewer it skipped', () => {
    setCadence(2);
    const sim = createFixture(0);
    const alice = sim.addPlayer({ name: 'Alice', position: tile(2, 2) });
    const walker = sim.addPlayer({ name: 'Walker', position: tile(4, 2) });
    resetPlayerNetState('Alice');
    resetPlayerNetState('Walker');

    const ws = fakeWs(0);
    playersWsMap.set('Alice', ws as unknown as WebSocket);

    const patches: Record<string, unknown>[] = [];
    for (let t = 0; t < 6; t++) {
      alice.position.x += 1;
      walker.position.x += 1;
      rebuildQuadtree(sim.mapId, sim.map);
      broadcastGameState();
      for (const call of ws.send.mock.calls.splice(0)) {
        const message = JSON.parse(String(call[0])) as {
          type: string;
          payload: { entities: Record<string, Record<string, unknown>> };
        };
        if (message.type !== 'worldUpdate') continue;
        const patch = message.payload.entities[walker.id];
        if (patch) patches.push(patch);
      }
    }

    // The first one is the insert, complete by contract. Every one after it is
    // a viewer catching up across a skipped tick, and must carry what moved.
    expect(patches.length).toBeGreaterThan(1);
    expect(patches[0]).toHaveProperty('name');
    for (const patch of patches.slice(1)) {
      expect(patch).toHaveProperty('position');
      expect(patch).not.toHaveProperty('name');
    }
    resetPlayerNetState('Walker');
  });

  it('serves a viewer its first update without waiting for its phase', () => {
    setCadence(4);
    const sim = createFixture(0);
    sim.addPlayer({ name: 'Alice', position: tile(2, 2) });
    const ws = fakeWs(0);
    playersWsMap.set('Alice', ws as unknown as WebSocket);
    rebuildQuadtree(sim.mapId, sim.map);

    broadcastGameState();

    expect(ws.send).toHaveBeenCalled();
  });
});

// Cold state carries each held item's whole definition, but what decides a
// resend compares only ids and quantities, so a catalogue edit has to reach
// the holders some other way.
describe('item definitions in cold state', () => {
  const potion: Item = {
    id: 1,
    name: 'Health Potion',
    description: '',
    sprite: 0,
    type: 'consumable',
  };
  const sword: Item = {
    id: 2,
    name: 'Sword',
    description: '',
    sprite: 0,
    type: 'weapon',
  };

  afterEach(() => {
    vi.restoreAllMocks();
    resetPlayerNetState('Bob');
    resetEntityReplication();
  });

  function connect(name: string) {
    const ws = fakeWs(0);
    playersWsMap.set(name, ws as unknown as WebSocket);
    return ws;
  }

  function statsSent(ws: ReturnType<typeof fakeWs>): PlayerCold[] {
    return ws.send.mock.calls
      .map(
        (c) =>
          JSON.parse(String(c[0])) as { type: string; payload: PlayerCold },
      )
      .filter((m) => m.type === 'playerStats')
      .map((m) => m.payload);
  }

  it('resends to holders of an edited item, and only to them', async () => {
    vi.spyOn(ItemModel, 'findOneAndUpdate').mockResolvedValue(null);
    const sim = createFixture(0);
    sim.addItem(potion);
    sim.addItem(sword);
    sim.addPlayer({
      name: 'Alice',
      inventory: { items: [{ item: 1, quantity: 3 }], maxCapacity: 10 },
    });
    sim.addPlayer({
      name: 'Bob',
      inventory: { items: [{ item: 2, quantity: 1 }], maxCapacity: 10 },
    });
    rebuildQuadtree(sim.mapId, sim.map);
    const alice = connect('Alice');
    const bob = connect('Bob');
    broadcastGameState();

    await createOrUpdateItem({ ...potion, name: 'Aurora Elixir' });
    broadcastGameState();

    expect(statsSent(alice).at(-1)?.inventory[0]?.item.name).toBe(
      'Aurora Elixir',
    );
    expect(statsSent(bob)).toHaveLength(1);
  });

  it('resends to a player wearing a deleted item', async () => {
    vi.spyOn(ItemModel, 'deleteOne').mockResolvedValue(null as never);
    const sim = createFixture(0);
    sim.addItem(sword);
    sim.addPlayer({ name: 'Alice', equipped: { weapon: 2 } });
    rebuildQuadtree(sim.mapId, sim.map);
    const alice = connect('Alice');
    broadcastGameState();

    await deleteItem(2);
    broadcastGameState();

    const sent = statsSent(alice);
    expect(sent).toHaveLength(2);
    expect(sent[1]?.equipped.weapon).toBeUndefined();
  });

  it('keeps serving a player carrying a deleted item', async () => {
    vi.spyOn(ItemModel, 'deleteOne').mockResolvedValue(null as never);
    vi.spyOn(DeliveryModel, 'deleteMany').mockResolvedValue({
      deletedCount: 0,
    } as never);
    const sim = createFixture(0);
    sim.addItem(potion);
    sim.addItem(sword);
    const player = sim.addPlayer({
      name: 'Alice',
      inventory: {
        items: [
          { item: 1, quantity: 3 },
          { item: 2, quantity: 1 },
        ],
        maxCapacity: 10,
      },
    });
    rebuildQuadtree(sim.mapId, sim.map);
    const alice = connect('Alice');
    broadcastGameState();

    await deleteItem(2);
    // Gives `self` news, so a healthy tick owes Alice a world update.
    player.position.x += 1;
    alice.send.mockClear();
    broadcastGameState();

    const types = alice.send.mock.calls.map(
      (c) => (JSON.parse(String(c[0])) as { type: string }).type,
    );
    expect(types).toContain('worldUpdate');
    expect(statsSent(alice)[0]?.inventory.map((e) => e.item.id)).toEqual([1]);
  });
});
