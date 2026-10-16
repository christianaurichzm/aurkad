import { describe, it, expect, beforeEach } from 'vitest';
import { MapStateServer, PlayerServer } from '../../shared/types.js';
import { players, playersByName, runtimeState } from './state.js';
import { drainDirtyPlayerIds } from '../persistence/dirtyPlayers.js';
import {
  registerPlayer,
  unregisterPlayer,
  upsertOnCurrentMap,
  placePlayerOnMap,
  detachFromMap,
  getPlayerById,
  getPlayerByName,
  getAllPlayers,
  updatePlayer,
} from './world.js';

function mkPlayer(id: string, name: string, mapId: string): PlayerServer {
  return {
    id,
    name,
    mapId,
    position: { x: 0, y: 0 },
  } as unknown as PlayerServer;
}

function mkMap(id: string): MapStateServer {
  return { id, players: {}, tiles: [] } as unknown as MapStateServer;
}

beforeEach(() => {
  for (const k of Object.keys(players)) delete players[k];
  playersByName.clear();
  for (const k of Object.keys(runtimeState.maps)) delete runtimeState.maps[k];
});

describe('world registry', () => {
  it('indexes a registered player by id and name', () => {
    const p = mkPlayer('a', 'Alice', '1');
    registerPlayer(p);

    expect(getPlayerById('a')).toBe(p);
    expect(getPlayerByName('Alice')).toBe(p);
    expect(getAllPlayers()).toEqual([p]);
  });

  it('attaches a player to its current map on upsert', () => {
    runtimeState.maps['1'] = mkMap('1');
    const p = mkPlayer('a', 'Alice', '1');
    registerPlayer(p);

    upsertOnCurrentMap(p);

    expect(runtimeState.maps['1'].players['a']).toBe(p);
    expect(getPlayerById('a')).toBe(p);
  });

  it('does not bring back a player through an object kept past logout', () => {
    runtimeState.maps['1'] = mkMap('1');
    const p = mkPlayer('a', 'Alice', '1');
    registerPlayer(p);
    unregisterPlayer('a');

    updatePlayer(p);
    placePlayerOnMap(p);

    expect(getPlayerById('a')).toBeUndefined();
    expect(runtimeState.maps['1'].players['a']).toBeUndefined();
  });

  it('does not let the object of an old session replace the next one', () => {
    runtimeState.maps['1'] = mkMap('1');
    const old = mkPlayer('a', 'Alice', '1');
    registerPlayer(old);
    unregisterPlayer('a');
    const next = mkPlayer('a', 'Alice', '1');
    registerPlayer(next);
    upsertOnCurrentMap(next);

    updatePlayer(old);

    expect(getPlayerByName('Alice')).toBe(next);
    expect(runtimeState.maps['1'].players['a']).toBe(next);
  });

  it('unregisters from the registry, name index and all maps', () => {
    runtimeState.maps['1'] = mkMap('1');
    const p = mkPlayer('a', 'Alice', '1');
    registerPlayer(p);
    upsertOnCurrentMap(p);

    unregisterPlayer('a');

    expect(getPlayerById('a')).toBeUndefined();
    expect(getPlayerByName('Alice')).toBeUndefined();
    expect(runtimeState.maps['1'].players['a']).toBeUndefined();
  });
});

describe('world map membership', () => {
  it('moves a player between maps on an explicit transition', () => {
    runtimeState.maps['1'] = mkMap('1');
    runtimeState.maps['2'] = mkMap('2');
    const p = mkPlayer('a', 'Alice', '1');
    registerPlayer(p);
    upsertOnCurrentMap(p);

    p.mapId = '2';
    placePlayerOnMap(p, '1');

    expect(runtimeState.maps['1'].players['a']).toBeUndefined();
    expect(runtimeState.maps['2'].players['a']).toBe(p);
  });

  it('puts where a player moved to in the next snapshot', () => {
    runtimeState.maps['1'] = mkMap('1');
    const p = mkPlayer('a', 'Alice', '1');
    registerPlayer(p);
    drainDirtyPlayerIds();

    p.position = { x: 64, y: 0 };
    placePlayerOnMap(p);

    expect(drainDirtyPlayerIds()).toEqual(['a']);
  });

  it('detaches from the current map but keeps the player registered', () => {
    runtimeState.maps['1'] = mkMap('1');
    const p = mkPlayer('a', 'Alice', '1');
    registerPlayer(p);
    upsertOnCurrentMap(p);

    detachFromMap('a');

    expect(runtimeState.maps['1'].players['a']).toBeUndefined();
    expect(getPlayerById('a')).toBe(p);
  });
});
