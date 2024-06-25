import { Enemy } from '../shared/types';

export const respawnEnemy = (enemy: Enemy): void => {
  enemy.health = 100;
  enemy.position.x = Math.random() * 750;
  enemy.position.y = Math.random() * 550;
};
