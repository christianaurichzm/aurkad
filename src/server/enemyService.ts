import { Enemy } from '../shared/types';

export const respawnEnemy = (enemy: Enemy): void => {
  enemy.health = 100;
  enemy.x = Math.random() * 750;
  enemy.y = Math.random() * 550;
};
