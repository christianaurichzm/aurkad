import { GameState, MessageType, Player } from '../shared/types';
import {
  getEnemies,
  getMap,
  getPlayer,
  getPlayers,
  updateMap,
} from './database';
import { respawnEnemy } from './enemyService';
import {
  createPlayer,
  handlePlayerUpdates,
  levelUpPlayer,
} from './playerService';

export const FIRST_GAME_MAP_ID = '1';

export const login = (username: string) => {
  return (
    Object.values(getPlayers()).find((player) => player.name === username) ||
    createPlayer(username)
  );
};

export const handlePlayerUpdate = (player: Player): void => {
  handlePlayerUpdates(player);
};

export const handleAttack = (playerId?: string): void => {
  if (!playerId) return;
  const player = getPlayer(playerId);

  const enemies = getEnemies();
  Object.values(enemies).forEach((enemy) => {
    const distanceX = Math.abs(player.x - enemy.x);
    const distanceY = Math.abs(player.y - enemy.y);

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
  const map = getMap(player.mapId);
  map.players[playerId] = player;
  return updateMap(map);
};

export const disconnectPlayer = (playerId: string) => {
  const player = getPlayer(playerId);
  const map = getMap(player.mapId);
  delete map.players[playerId];
  updateMap(map);
};

export const getGameState = (mapId: string): GameState => ({
  type: MessageType.GAME_STATE,
  map: getMap(mapId),
});
