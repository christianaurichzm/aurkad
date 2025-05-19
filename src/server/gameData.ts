import {
  GameState,
  MapStateServer,
  PlayerServer,
  PlayersServerMap,
  Character,
  NpcsMap,
  Npc,
} from '../shared/types';
import { createOrUpdateMap } from './services/mapService';
import { createOrUpdateNpc, deleteNpc } from './services/npcService';
import { createOrUpdatePlayer, deletePlayer } from './services/playerService';

export const players: PlayersServerMap = {};

export const npcs: NpcsMap = {};

export const runtimeState: GameState = {
  maps: {
    '1': {
      id: '1',
      name: 'First map',
      type: 'normal',
      players: {},
      npcs: { ...npcs },
      droppedItems: [],
      tiles: Array.from({ length: 448 / 32 }, () =>
        Array(640 / 32).fill({ tileIndex: -1, blocked: false }),
      ),
    },
    '2': {
      id: '2',
      name: 'Second map',
      type: 'pvp',
      players: {},
      npcs: {},
      droppedItems: [],
      tiles: Array.from({ length: 448 / 32 }, () =>
        Array(640 / 32).fill({ tileIndex: -1, blocked: false }),
      ),
    },
  },
};

export const getRuntimeState = (): GameState => {
  return runtimeState;
};

export const getMap = (
  mapId: string | undefined,
): MapStateServer | undefined => {
  if (!mapId) return undefined;
  const map = runtimeState.maps[mapId];
  if (map) {
    return map;
  }
  console.warn('getMap: Map not found', mapId);
  return undefined;
};

export const updateMap = (map: MapStateServer): MapStateServer | undefined => {
  if (runtimeState.maps[map.id]) {
    runtimeState.maps[map.id] = map;
    return runtimeState.maps[map.id];
  } else {
    console.warn('updateMap: Map not found', map.id);
  }
};

export const updateMapById = async (
  mapState: MapStateServer,
): Promise<MapStateServer | undefined> => {
  if (!mapState) return;

  if (!runtimeState.maps[mapState.id]) {
    console.warn('updateMap: Map not found', mapState.id);
    return;
  }

  runtimeState.maps[mapState.id] = { ...mapState };

  const { players, npcs, droppedItems, ...mapToSave } = mapState;

  await createOrUpdateMap(mapToSave);
  return runtimeState.maps[mapState.id];
};

export const addPlayer = async (player: PlayerServer): Promise<void> => {
  players[player.id] = player;
  const mapId = player.mapId;
  if (runtimeState.maps[mapId]) {
    runtimeState.maps[mapId].players[player.id] = player;
  } else {
    console.warn('addPlayer: Map not found', mapId);
  }
  await createOrUpdatePlayer(player);
};

export const removePlayer = async (playerId: string): Promise<void> => {
  delete players[playerId];
  Object.values(runtimeState.maps).forEach((map) => {
    delete map.players[playerId];
  });
  await deletePlayer(playerId);
};

export const getPlayer = (playerId: string): PlayerServer | undefined => {
  const player = players[playerId];
  if (player) {
    return player;
  }
  console.warn('getPlayer: Player not found', playerId);
  return undefined;
};

export const updatePlayer = async (player: PlayerServer): Promise<void> => {
  console.log('[updatePlayer] inventory:', player.inventory.items);
  if (players[player.id]) {
    players[player.id] = player;

    const mapId = player.mapId;
    if (runtimeState.maps[mapId]) {
      runtimeState.maps[mapId].players[player.id] = player;
    } else {
      console.warn('updatePlayer: Map not found', mapId);
    }
    await createOrUpdatePlayer(player);
  } else {
    console.warn('updatePlayer: Player not found', player.id);
  }
};

export const updateNpc = async (npc: Character): Promise<void> => {
  npcs[npc.id] = { ...npc } as Npc;
  await createOrUpdateNpc(npcs[npc.id]);
};

export const getPlayers = (): PlayersServerMap => {
  return players;
};

export const setNpcs = (newNpcs: Npc[], persist = true): void => {
  newNpcs.forEach(async (npc) => {
    npcs[npc.id] = npc;
    Object.values(runtimeState.maps).forEach((map) => {
      if (map.npcs[npc.id]) {
        map.npcs[npc.id] = npc;
      }
    });
    await createOrUpdateNpc(npc);
  });
};

export const getNpcs = (): NpcsMap => {
  return npcs;
};

export const getNpcsInMap = (mapId: MapStateServer['id']): NpcsMap => {
  return runtimeState.maps[mapId].npcs;
};

function getNextNpcId(): string {
  const ids = Object.keys(npcs).map(Number);
  return String(ids.length ? Math.max(...ids) + 1 : 1);
}

export async function addNpc(npc: Omit<Npc, 'id'>): Promise<Npc> {
  const id = getNextNpcId();
  const newNpc: Npc = { ...npc, id };
  npcs[id] = newNpc;
  await createOrUpdateNpc(newNpc);
  return newNpc;
}

export async function updateNpcAll(
  id: string,
  data: Partial<Npc>,
): Promise<Npc | undefined> {
  const npc = npcs[id];
  if (!npc) return undefined;
  Object.assign(npc, data);
  Object.values(runtimeState.maps).forEach((map) => {
    if (map.npcs && map.npcs[id]) {
      Object.assign(map.npcs[id], data);
    }
  });
  await createOrUpdateNpc(npc);
  return npc;
}

export async function deleteNpcEverywhere(id: string): Promise<void> {
  delete npcs[id];
  Object.values(runtimeState.maps).forEach((map) => {
    if (map.npcs && map.npcs[id]) {
      delete map.npcs[id];
    }
  });
  await deleteNpc(id);
}
