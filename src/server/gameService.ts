import { GameState, MessageType, Player } from '../shared/types';
import { getEnemies, getPlayer, getPlayers } from './database';
import { respawnEnemy } from './enemyService';
import { handlePlayerUpdates, levelUpPlayer } from './playerService';

export const handlePlayerUpdate = (player: Player): void => {
  handlePlayerUpdates(player);
};

export const handleAttack = (playerId: string): void => {
  const player = getPlayer(playerId);
  if (!player) return;

  const enemies = getEnemies();
  enemies.forEach((enemy) => {
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

export const getGameState = (): GameState => ({
  type: MessageType.GAME_STATE,
  players: getPlayers(),
  enemies: getEnemies(),
});
