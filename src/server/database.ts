import {
  EnemiesMap,
  Enemy,
  GameMap,
  Player,
  PlayersMap,
} from '../shared/types';

const players: PlayersMap = {};

const enemies: EnemiesMap = {
  '1': {
    id: '1',
    x: 200,
    y: 200,
    width: 50,
    height: 50,
    color: 'red',
    health: 100,
    experienceValue: 500,
  },
  '2': {
    id: '2',
    x: 400,
    y: 400,
    width: 50,
    height: 50,
    color: 'green',
    health: 100,
    experienceValue: 500,
  },
};

const maps: { [key: string]: GameMap } = {
  '1': {
    id: '1',
    players: {},
    enemies: enemies,
    background: 'grey',
  },
  '2': {
    id: '2',
    players: {},
    enemies: {},
    background: 'blue',
  },
};

export const getMap = (mapId: string): GameMap => maps[mapId];

export const updateMap = (map: GameMap) => (maps[map.id] = map);

export const addPlayer = (player: Player): void => {
  players[player.id] = player;
};

export const removePlayer = (playerId: string): void => {
  delete players[playerId];
};

export const getPlayer = (playerId: string): Player => {
  return players[playerId];
};

export const updatePlayer = (player: Player): void => {
  players[player.id].x = player.x;
  players[player.id].y = player.y;
  players[player.id].speed = player.speed;
};

export const levelUp = (player: Player): void => {
  players[player.id].level = player.level;
};

export const getPlayers = (): PlayersMap => {
  return players;
};

export const setEnemies = (newEnemies: Enemy[]): void => {
  newEnemies.forEach((enemy) => (enemies[enemy.id] = enemy));
};

export const getEnemies = (): EnemiesMap => {
  return enemies;
};
