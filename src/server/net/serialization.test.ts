/**
 * What a tile chunk may tell the client. A `Tile` holds the square's rules
 * (which script a step runs and with what, where a warp goes, what a door
 * wants), and sent whole it would let any player read a map's puzzles off
 * the wire. The key set is asserted exactly, so a new `Tile` field does not
 * join the payload by being new.
 */
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { toMapChunk, toPlayerCold } from './serialization.js';
import { broadcastGameState } from './snapshot.js';
import { resetPlayerNetState } from './viewerState.js';
import { resetEntityReplication } from './entityReplication.js';
import { playersWsMap } from './connections.js';
import { createFixture } from '../sim/simFixture.js';
import { rebuildQuadtree } from '../sim/spatialManager.js';
import type { MapStateServer, Tile } from '../../shared/types.js';
import type { WsServerMessage } from '../../shared/wsProtocol.js';

const PUBLIC_TILE_KEYS = ['tileIndex', 'maskIndex', 'fringeIndex'];

/** Every server-side field a tile can carry, so none is tested by omission. */
const loadedTile: Tile = {
  tileIndex: 7,
  maskIndex: 3,
  fringeIndex: 4,
  blocked: true,
  warp: { to: 'secret-map', position: { x: 32, y: 64 } },
  npcSpawn: 'boss-npc',
  item: 12,
  shop: 'secret-shop',
  bank: true,
  avoidNpc: true,
  triggers: [
    {
      action: 'script',
      scriptId: 'hidden-reward',
      scriptParams: { gold: 999 },
    },
  ],
  door: { requiresItem: 42, openTileIndex: 8 },
  conditionalBlock: 'quest-gate',
};

describe('toMapChunk', () => {
  it('carries the three fields the renderer needs and no others', () => {
    const map = { id: 'm1', tiles: [[loadedTile]] } as MapStateServer;

    const sent = toMapChunk(map, 0, 0).tiles[0]?.[0];

    expect(Object.keys(sent!).sort()).toEqual([...PUBLIC_TILE_KEYS].sort());
    expect(sent).toMatchObject({ tileIndex: 7, maskIndex: 3, fringeIndex: 4 });
  });

  it('does not alias the live tile', () => {
    const map = { id: 'm1', tiles: [[{ ...loadedTile }]] } as MapStateServer;

    const sent = toMapChunk(map, 0, 0).tiles[0]?.[0];

    expect(sent).not.toBe(map.tiles[0]![0]);
  });
});

describe('the chunk an ordinary player actually receives', () => {
  afterEach(() => {
    for (const name of playersWsMap.keys()) resetPlayerNetState(name);
    playersWsMap.clear();
    resetEntityReplication();
  });

  it('has no trace of the server-side rules for a tile', () => {
    const sim = createFixture(0);
    sim.map.tiles = [[{ ...loadedTile }]];
    const player = sim.addPlayer({ position: { x: 0, y: 0 }, access: 0 });

    const frames: string[] = [];
    playersWsMap.set(player.name, {
      readyState: WebSocket.OPEN,
      bufferedAmount: 0,
      send: (data: string) => frames.push(data),
    } as unknown as WebSocket);
    rebuildQuadtree(sim.mapId, sim.map);

    broadcastGameState();

    const chunk = frames
      .map((frame) => JSON.parse(frame) as WsServerMessage)
      .find((frame) => frame.type === 'mapChunk');
    expect(chunk?.payload.tiles[0]?.[0]?.tileIndex).toBe(7);
    // Asserted on the encoded frame, not the object: only a key that survives
    // JSON.stringify reaches anybody.
    const wire = frames.find((frame) => frame.includes('mapChunk'))!;
    expect(wire).not.toContain('hidden-reward');
    expect(wire).not.toContain('secret-map');
    expect(wire).not.toContain('quest-gate');
    expect(wire).not.toContain('boss-npc');
  });
});

describe('toPlayerCold', () => {
  const fx = createFixture();

  it('handles a player whose equipped/inventory were dropped by mongoose minimize', () => {
    const player = fx.addPlayer({
      equipped: undefined,
      inventory: undefined,
    });

    const cold = toPlayerCold(player);

    expect(cold.equipped).toEqual({});
    expect(cold.inventory).toEqual([]);
  });

  it('says how much the bag holds', () => {
    const cold = toPlayerCold(
      fx.addPlayer({ inventory: { items: [], maxCapacity: 24 } }),
    );

    expect(cold.inventoryCapacity).toBe(24);
  });

  it('carries nameColor, nameTag and its colour through serialization', () => {
    const cold = toPlayerCold(
      fx.addPlayer({
        nameColor: 'gold',
        nameTag: '[Dragons]',
        nameTagColor: 'purple',
      }),
    );
    expect(cold.nameColor).toBe('gold');
    expect(cold.nameTag).toBe('[Dragons]');
    expect(cold.nameTagColor).toBe('purple');
  });
});
