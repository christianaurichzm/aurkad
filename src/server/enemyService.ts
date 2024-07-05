import { Character, Direction, Enemy, MapState } from '../shared/types';
import { hasCollision } from './gameService';

export const respawnEnemy = (enemy: Enemy): void => {
  enemy.health = 100;
  enemy.position.x = Math.random() * 750;
  enemy.position.y = Math.random() * 550;
};

function calculateDirection(
  from: Character,
  to: Character,
): { dx: number; dy: number; distance: number } {
  const dx = to.position.x - from.position.x;
  const dy = to.position.y - from.position.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  return { dx, dy, distance };
}

export function moveEnemyTowardsPlayer(enemy: Character, player: Character) {
  const { dx, dy } = calculateDirection(enemy, player);

  if (Math.abs(dx) > Math.abs(dy)) {
    enemy.position.x += Math.sign(dx) * enemy.speed;
    enemy.direction = dx > 0 ? Direction.Right : Direction.Left;
  } else {
    enemy.position.y += Math.sign(dy) * enemy.speed;
    enemy.direction = dy > 0 ? Direction.Down : Direction.Up;
  }
}

export function findClosestPlayer(
  enemy: Character,
  players: Character[],
): Character | null {
  let closestPlayer: Character | null = null;
  let shortestDistance = Infinity;

  players.forEach((player) => {
    const { distance } = calculateDirection(enemy, player);

    if (distance < shortestDistance) {
      shortestDistance = distance;
      closestPlayer = player;
    }
  });

  return closestPlayer;
}

export function updateEnemies(enemy: Enemy, map: MapState) {
  const closestPlayer = findClosestPlayer(enemy, Object.values(map.players));
  if (closestPlayer && !hasCollision(enemy)) {
    moveEnemyTowardsPlayer(enemy, closestPlayer);
  }
}
