import { Enemy } from '../shared/types';
import { getEnemies, getPlayer, respawnEnemy as respawn } from './database';
import { levelUpPlayer } from './playerService';

export const respawnEnemy = (enemy: Enemy): void => {
  respawn(enemy);
};

export const handleAttack = (playerId: string): void => {
  const player = getPlayer(playerId);
  if (!player) throw new Error('Player not found');

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
