import { PlayerAction, Player, MapState, MovePayload } from '../shared/types';
import {
  getEnemies,
  getEnemiesInMap,
  getGameStateDb,
  getMap,
  getPlayer,
  getPlayers,
  updateMap,
  updatePlayer,
} from './database';
import { respawnEnemy } from './enemyService';
import {
  createPlayer,
  handlePlayerUpdates,
  levelUpPlayer,
} from './playerService';

export const FIRST_GAME_MAP_ID = '1';

export const getGameState = () => getGameStateDb();

export const getPlayerByName = (username: string) =>
  Object.values(getPlayers()).find((player) => player.name === username);

export const login = (username: string) => {
  return getPlayerByName(username) || createPlayer(username);
};

export const handlePlayerUpdate = (player: Player): void => {
  handlePlayerUpdates(player);
};

export const handleAttack = (playerId?: string): void => {
  if (!playerId) return;
  const player = getPlayer(playerId);
  if (!player) return;

  const enemies = getEnemies();
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
};

export const addPlayerOnMap = (playerId: string) => {
  const player = getPlayer(playerId);
  if (!player) return;
  const map = getMap(player.mapId);
  if (!map) return;
  map.players[playerId] = player;
  return updateMap(map);
};

export const disconnectPlayer = (playerId: string) => {
  const player = getPlayer(playerId);
  if (!player) return;
  const map = getMap(player.mapId);
  if (!map) return;
  delete map.players[playerId];
  updateMap(map);
};

export function applyAction(
  state: MapState,
  action: PlayerAction,
  username: string,
) {
  switch (action.type) {
    case 'move':
      applyMoveAction(action, username);
      break;
    case 'attack':
      applyAttackAction(action, username);
      break;
    case 'boost':
      applyBoostAction(action, username);
      break;
  }
}

function applyMoveAction(action: PlayerAction, username: string) {
  const player = getPlayerByName(username);
  if (!player) {
    console.warn('applyMoveAction: Player not found', username);
    return;
  }

  const newPosition = { ...player.position };
  if ((action.payload as MovePayload).direction === 'up') {
    newPosition.y -= player.speed;
  }
  if ((action.payload as MovePayload).direction === 'down') {
    newPosition.y += player.speed;
  }
  if ((action.payload as MovePayload).direction === 'left') {
    newPosition.x -= player.speed;
  }
  if ((action.payload as MovePayload).direction === 'right') {
    newPosition.x += player.speed;
  }

  updatePlayer({ ...player, position: newPosition });
}

function applyAttackAction(action: PlayerAction, username: string) {
  const { type } = action;
  if (!username || type !== 'attack') return;
  const player = getPlayerByName(username);
  if (!player) return;

  const enemies = getEnemiesInMap(player.mapId);

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

function applyBoostAction(action: PlayerAction, username: string) {
  const { type, keyState } = action;

  if (!username || type !== 'boost') return;

  const player = getPlayerByName(username);
  if (!player) return;
  const originalSpeed = { ...player }.speed;

  if (keyState === 'keydown') {
    player.speed *= 4;
  } else {
    player.speed = originalSpeed;
  }
}
