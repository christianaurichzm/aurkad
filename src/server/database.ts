import { SPRITE_HEIGHT, SPRITE_WIDTH, TILE_SIZE } from '../shared/constants';
import {
  PlayerAction,
  Direction,
  GameState,
  MapState,
  Player,
  PlayersMap,
  Character,
  ItemsMap,
  NpcsMap,
  Npc,
  EquippedItems,
  Item,
  BanEntry,
} from '../shared/types';

export const bannedPlayers: Record<string, BanEntry> = {};

const players: PlayersMap = {};

const items: ItemsMap = {
  1: {
    id: 1,
    name: 'Sword',
    description: 'A sharp blade.',
    sprite: 1,
    type: 'weapon',
    effects: [
      {
        attribute: 'attack',
        type: 'add',
        value: 20,
      },
    ],
  },
};

const npcs: NpcsMap = {
  '1': {
    id: '1',
    position: {
      x: 4 * TILE_SIZE,
      y: 2 * TILE_SIZE,
    },
    name: 'One',
    behavior: 'hostile',
    width: SPRITE_WIDTH,
    height: SPRITE_HEIGHT,
    maxHealth: 100,
    health: 100,
    experienceValue: 500,
    sprite: 0,
    mapId: '1',
    attack: 40,
    attackRange: TILE_SIZE,
    direction: Direction.Down,
    action: PlayerAction.Idle,
  },
  '2': {
    id: '2',
    position: {
      x: 7 * TILE_SIZE,
      y: 2 * TILE_SIZE,
    },
    name: 'Two',
    behavior: 'hostile',
    itemsToDrop: [{ itemId: 1, chance: 50 }],
    width: SPRITE_WIDTH,
    height: SPRITE_HEIGHT,
    maxHealth: 100,
    health: 100,
    experienceValue: 500,
    sprite: 0,
    mapId: '1',
    attack: 40,
    attackRange: TILE_SIZE,
    direction: Direction.Down,
    action: PlayerAction.Idle,
  },
};

const gameState: GameState = {
  maps: {
    '1': {
      id: '1',
      name: 'First map',
      type: 'normal',
      players: {},
      npcs: { ...npcs },
      droppedItems: [
        {
          position: { x: 0, y: 0 },
          itemId: items[1].id,
          sprite: items[1].sprite,
        },
      ],
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

export const getGameStateDb = (): GameState => {
  return gameState;
};

export const getMap = (mapId: string | undefined): MapState | undefined => {
  if (!mapId) return undefined;
  const map = gameState.maps[mapId];
  if (map) {
    return map;
  }
  console.warn('getMap: Map not found', mapId);
  return undefined;
};

export const updateMap = (map: MapState): MapState | undefined => {
  if (gameState.maps[map.id]) {
    gameState.maps[map.id] = map;
    return gameState.maps[map.id];
  } else {
    console.warn('updateMap: Map not found', map.id);
  }
};

export const updateMapById = (mapState: MapState): MapState | undefined => {
  if (mapState) {
    if (gameState.maps[mapState.id]) {
      gameState.maps[mapState.id] = { ...mapState };
      return gameState.maps[mapState.id];
    } else {
      console.warn('updateMap: Map not found', mapState.id);
    }
  }
};

export const addPlayer = (player: Player): void => {
  players[player.id] = player;
  const mapId = player.mapId;
  if (gameState.maps[mapId]) {
    gameState.maps[mapId].players[player.id] = player;
  } else {
    console.warn('addPlayer: Map not found', mapId);
  }
};

export const removePlayer = (playerId: string): void => {
  delete players[playerId];
  Object.values(gameState.maps).forEach((map) => {
    delete map.players[playerId];
  });
};

export const getPlayer = (playerId: string): Player | undefined => {
  const player = players[playerId];
  if (player) {
    return player;
  }
  console.warn('getPlayer: Player not found', playerId);
  return undefined;
};

export const updatePlayer = (player: Player): void => {
  if (players[player.id]) {
    players[player.id] = player;

    const mapId = player.mapId;
    if (gameState.maps[mapId]) {
      gameState.maps[mapId].players[player.id] = player;
    } else {
      console.warn('updatePlayer: Map not found', mapId);
    }
  } else {
    console.warn('updatePlayer: Player not found', player.id);
  }
};

export const updateNpc = (npc: Character): void => {
  npcs[npc.id] = { ...npc } as Npc;
};

export const getPlayers = (): PlayersMap => {
  return players;
};

export const setNpcs = (newNpcs: Npc[]): void => {
  newNpcs.forEach((npc) => {
    npcs[npc.id] = npc;
    Object.values(gameState.maps).forEach((map) => {
      if (map.npcs[npc.id]) {
        map.npcs[npc.id] = npc;
      }
    });
  });
};

export const getItems = (): ItemsMap => {
  return items;
};

export const getNpcs = (): NpcsMap => {
  return npcs;
};

export const getNpcsInMap = (mapId: MapState['id']): NpcsMap => {
  return gameState.maps[mapId].npcs;
};

function getNextNpcId(): string {
  const ids = Object.keys(npcs).map(Number);
  return String(ids.length ? Math.max(...ids) + 1 : 1);
}

export function addNpc(npc: Omit<Npc, 'id'>): Npc {
  const id = getNextNpcId();
  const newNpc: Npc = { ...npc, id };
  npcs[id] = newNpc;
  return newNpc;
}

export function updateNpcAll(id: string, data: Partial<Npc>): Npc | undefined {
  const npc = npcs[id];
  if (!npc) return undefined;
  Object.assign(npc, data);
  Object.values(gameState.maps).forEach((map) => {
    if (map.npcs && map.npcs[id]) {
      Object.assign(map.npcs[id], data);
    }
  });
  return npc;
}

export function deleteNpcEverywhere(id: string): void {
  delete npcs[id];
  Object.values(gameState.maps).forEach((map) => {
    if (map.npcs && map.npcs[id]) {
      delete map.npcs[id];
    }
  });
}

function getNextItemId(): number {
  const ids = Object.keys(items).map(Number);
  return ids.length ? Math.max(...ids) + 1 : 1;
}

export function addItem(item: Omit<Item, 'id'>): Item {
  const id = getNextItemId();
  const newItem: Item = { ...item, id };
  items[id] = newItem;
  return newItem;
}

export function updateItemEverywhere(
  id: number,
  data: Partial<Item>,
): Item | undefined {
  const item = items[id];
  if (!item) return undefined;
  Object.assign(item, data);
  Object.values(players).forEach((player) => {
    player.inventory.items.forEach((invItem) => {
      if (invItem.id === id) {
        Object.assign(invItem, data);
      }
    });
    if (player.equipped) {
      (Object.keys(player.equipped) as (keyof EquippedItems)[]).forEach(
        (slot) => {
          const equip = player.equipped[slot];
          if (equip && equip.id === id) {
            Object.assign(equip, data);
          }
        },
      );
    }
  });
  return item;
}

export function deleteItemEverywhere(id: number): void {
  delete items[id];
  Object.values(players).forEach((player) => {
    player.inventory.items = player.inventory.items.filter(
      (item) => item.id !== id,
    );
    if (player.equipped) {
      (Object.keys(player.equipped) as (keyof EquippedItems)[]).forEach(
        (slot) => {
          const equip = player.equipped[slot];
          if (equip && equip.id === id) {
            player.equipped[slot] = undefined;
          }
        },
      );
    }
  });
  Object.values(gameState.maps).forEach((map) => {
    map.droppedItems = map.droppedItems.filter((drop) => drop.itemId !== id);
  });
}
