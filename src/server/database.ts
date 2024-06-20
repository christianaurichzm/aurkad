import { Enemy, Player } from '../shared/types';

const players: { [key: string]: Player } = {};
let enemies: Enemy[] = [
  {
    id: 1,
    x: 200,
    y: 200,
    width: 50,
    height: 50,
    color: 'red',
    health: 100,
    experienceValue: 500,
  },
  {
    id: 2,
    x: 400,
    y: 400,
    width: 50,
    height: 50,
    color: 'green',
    health: 100,
    experienceValue: 500,
  },
];

export const addPlayer = (player: Player): void => {
  players[player.id] = player;
};

export const removePlayer = (playerId: string): void => {
  delete players[playerId];
};

export const getPlayer = (playerId: string): Player | undefined => {
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

export const getPlayers = (): { [key: string]: Player } => {
  return players;
};

export const setEnemies = (newEnemies: Enemy[]): void => {
  enemies = newEnemies;
};

export const getEnemies = (): Enemy[] => {
  return enemies;
};

export const respawnEnemy = (enemy: Enemy): void => {
  enemy.health = 100;
  enemy.x = Math.random() * 750;
  enemy.y = Math.random() * 550;
};
