import {
  EnemiesMap,
  Enemy,
  GameState,
  MapState,
  Player,
  PlayersMap,
} from '../shared/types';

let players: PlayersMap = {};

let enemies: EnemiesMap = {
  '1': {
    id: '1',
    position: {
      x: 200,
      y: 200,
    },
    width: 50,
    height: 50,
    color: 'red',
    health: 100,
    experienceValue: 500,
  },
  '2': {
    id: '2',
    position: {
      x: 400,
      y: 400,
    },
    width: 50,
    height: 50,
    color: 'green',
    health: 100,
    experienceValue: 500,
  },
};

const gameState: GameState = {
  maps: {
    '1': {
      id: '1',
      players: {},
      enemies: { ...enemies },
    },
    '2': {
      id: '2',
      players: {},
      enemies: {},
    },
  },
};

export const getGameStateDb = (): GameState => {
  return { ...gameState };
};

export const getMap = (mapId: string): MapState | undefined => {
  const map = gameState.maps[mapId];
  if (map) {
    return { ...map };
  }
  console.warn('getMap: Map not found', mapId);
  return undefined;
};

export const updateMap = (map: MapState): MapState | undefined => {
  if (gameState.maps[map.id]) {
    const newMapState = { ...gameState.maps, [map.id]: { ...map } };
    gameState.maps = newMapState;
    return newMapState[map.id];
  } else {
    console.warn('updateMap: Map not found', map.id);
  }
};

export const addPlayer = (player: Player): void => {
  players = { ...players, [player.id]: { ...player } };
  const mapId = player.mapId;
  if (gameState.maps[mapId]) {
    gameState.maps[mapId].players = {
      ...gameState.maps[mapId].players,
      [player.id]: { ...player },
    };
  } else {
    console.warn('addPlayer: Map not found', mapId);
  }
};

export const removePlayer = (playerId: string): void => {
  const { [playerId]: _, ...rest } = players;
  players = { ...rest };
  Object.values(gameState.maps).forEach((map) => {
    const { [playerId]: _, ...restPlayers } = map.players;
    map.players = { ...restPlayers };
  });
};

export const getPlayer = (playerId: string): Player | undefined => {
  const player = players[playerId];
  if (player) {
    return { ...player };
  }
  console.warn('getPlayer: Player not found', playerId);
  return undefined;
};

export const updatePlayer = (player: Player): void => {
  if (players[player.id]) {
    players = { ...players, [player.id]: { ...player } };

    const mapId = player.mapId;
    if (gameState.maps[mapId]) {
      gameState.maps[mapId].players = {
        ...gameState.maps[mapId].players,
        [player.id]: { ...player },
      };
    } else {
      console.warn('updatePlayer: Map not found', mapId);
    }
  } else {
    console.warn('updatePlayer: Player not found', player.id);
  }
};

export const levelUp = (player: Player): void => {
  if (players[player.id]) {
    updatePlayer({ ...player, level: player.level + 1 });
  } else {
    console.warn('levelUp: Player not found', player.id);
  }
};

export const getPlayers = (): PlayersMap => {
  return { ...players };
};

export const setEnemies = (newEnemies: Enemy[]): void => {
  newEnemies.forEach((enemy) => {
    enemies = { ...enemies, [enemy.id]: { ...enemy } };
    Object.values(gameState.maps).forEach((map) => {
      if (map.enemies[enemy.id]) {
        map.enemies = { ...map.enemies, [enemy.id]: { ...enemy } };
      }
    });
  });
};

export const getEnemies = (): EnemiesMap => {
  return { ...enemies };
};

export const getEnemiesInMap = (mapId: MapState['id']): EnemiesMap => {
  return { ...gameState.maps[mapId].enemies };
};
