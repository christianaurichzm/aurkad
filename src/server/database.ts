import { SPRITE_HEIGHT, SPRITE_WIDTH, TILE_SIZE } from '../shared/constants';
import {
  PlayerAction,
  Direction,
  EnemiesMap,
  Enemy,
  GameState,
  MapState,
  Player,
  PlayersMap,
  Tile,
  Character,
  ItemsMap,
} from '../shared/types';

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

const enemies: EnemiesMap = {
  '1': {
    id: '1',
    position: {
      x: 4 * TILE_SIZE,
      y: 2 * TILE_SIZE,
    },
    width: SPRITE_WIDTH,
    height: SPRITE_HEIGHT,
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
    width: SPRITE_WIDTH,
    height: SPRITE_HEIGHT,
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
      enemies: { ...enemies },
      tiles: Array.from({ length: 448 / 32 }, () =>
        Array(640 / 32).fill({ tileIndex: -1, blocked: false }),
      ),
    },
    '2': {
      id: '2',
      name: 'Second map',
      type: 'pvp',
      players: {},
      enemies: {},
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

export const updateEnemy = (enemy: Character): void => {
  enemies[enemy.id] = { ...enemy } as Enemy;
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

export const getItems = (): ItemsMap => {
  return items;
};

export const getEnemies = (): EnemiesMap => {
  return enemies;
};

export const getEnemiesInMap = (mapId: MapState['id']): EnemiesMap => {
  return gameState.maps[mapId].enemies;
};
