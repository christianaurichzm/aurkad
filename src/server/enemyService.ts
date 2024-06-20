import { Enemy } from '../shared/types';
import {
  getEnemies,
  getPlayer,
  levelUp,
  respawnEnemy as respawn,
} from './database';

export const respawnEnemy = (enemy: Enemy): void => {
  respawn(enemy);
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

        while (player.experience >= player.experienceToNextLevel) {
          player.experience -= player.experienceToNextLevel;
          player.level++;
          player.experienceToNextLevel = Math.floor(
            100 * Math.pow(1.5, player.level - 1),
          );
        }
        respawnEnemy(enemy);
      }

      levelUp(player);
    }
  });
};
