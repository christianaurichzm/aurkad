import {
  EnemiesMap,
  Enemy,
  GameState,
  MapState,
  Player,
  PlayersMap,
} from '../shared/types';

const players: PlayersMap = {};

const enemies: EnemiesMap = {
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

export const getPlayers = (): PlayersMap => {
  return players;
};

export const setEnemies = (newEnemies: Enemy[]): void => {
  newEnemies.forEach((enemy) => {
    enemies[enemy.id] = enemy;
    Object.values(gameState.maps).forEach((map) => {
      if (map.enemies[enemy.id]) {
        map.enemies[enemy.id] = enemy;
      }
    });
  });
};

export const getEnemies = (): EnemiesMap => {
  return enemies;
};

export const getEnemiesInMap = (mapId: MapState['id']): EnemiesMap => {
  return gameState.maps[mapId].enemies;
};
