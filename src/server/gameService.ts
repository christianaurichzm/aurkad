import { Player, Key } from '../shared/types';
import {
  getEnemies,
  getGameStateDb,
  getMap,
  getPlayer,
  getPlayers,
  updateMap,
  updatePlayer,
} from './database';
import { respawnEnemy } from './enemyService';
import {
  DEFAULT_PLAYER_SPEED,
  createPlayer,
  handlePlayerUpdates,
  levelUpPlayer,
} from './playerService';

export const FIRST_GAME_MAP_ID = '1';

export function handleKeyPress(username: string, key: Key) {
  const player = getPlayerByName(username);
  if (player) {
    const newState = { ...player };
    if (key === Key.Shift) {
      newState.speed *= 2;
    }
    if (key === Key.ArrowUp) {
      newState.position.y -= newState.speed;
    }
    if (key === Key.ArrowDown) {
      newState.position.y += newState.speed;
    }
    if (key === Key.ArrowLeft) {
      newState.position.x -= newState.speed;
    }
    if (key === Key.ArrowRight) {
      newState.position.x += newState.speed;
    }
    if (key === Key.Control) {
      handleAttack(newState);
    }
    updatePlayer(newState);
  }
}

export function handleKeyRelease(username: string, key: Key) {
  const player = getPlayerByName(username);
  if (player) {
    const newState = { ...player };
    if (key === Key.Shift) {
      newState.speed = DEFAULT_PLAYER_SPEED;
    }
    updatePlayer(newState);
  }
}

export const getGameState = () => getGameStateDb();

export const getPlayerByName = (username: string) =>
  Object.values(getPlayers()).find((player) => player.name === username);

export const login = (username: string) => {
  return getPlayerByName(username) || createPlayer(username);
};

export const handlePlayerUpdate = (player: Player): void => {
  handlePlayerUpdates(player);
};

export const handleAttack = (player: Player): void => {
  if (!player) return;

  const map = getMap(player.mapId);
  const enemies = map?.enemies;
  if (enemies) {
    Object.values(enemies).forEach((enemy) => {
      const distanceX = Math.abs(player.position.x - enemy.position.x);
      const distanceY = Math.abs(player.position.y - enemy.position.y);

      if (
        distanceX <= player.attackRange &&
        distanceY <= player.attackRange &&
        enemy.health > 0
      ) {
        enemy.health -= player.attack;

        if (enemy.health <= 0) {
          enemy.health = 0;
          player.experience += enemy.experienceValue;

          levelUpPlayer(player);
          respawnEnemy(enemy);
        }
      }
    });
  }
};

export const addPlayerOnMap = (playerId: string) => {
  const player = getPlayer(playerId);
  if (!player) return;
  const map = getMap(player.mapId);
  if (!map) return;
  map.players[playerId] = player;
  return updateMap(map);
};

export const disconnectPlayer = (username?: string) => {
  if (!username) return;
  const player = getPlayerByName(username);
  if (!player) return;
  const map = getMap(player.mapId);
  if (!map) return;
  delete map.players[player.id];
  updateMap(map);
};
