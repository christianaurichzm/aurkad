import {
  Character,
  Direction,
  Enemy,
  MapState,
  Player,
  PlayerAction,
} from '../shared/types';
import { updatePlayer } from './database';
import { hasCollision } from './gameService';
import { respawnPlayer } from './playerService';

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

function moveEnemyTowardsPlayer(enemy: Character, player: Character) {
  const { dx, dy, distance } = calculateDirection(enemy, player);

  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  const tolerance = 1.0;

  if (absDx > absDy) {
    if (absDx > tolerance) {
      enemy.position.x += Math.sign(dx) * Math.min(enemy.speed, absDx);
      enemy.direction = dx > 0 ? Direction.Right : Direction.Left;
      enemy.action = PlayerAction.Walk;
    }
  } else {
    if (absDy > tolerance) {
      enemy.position.y += Math.sign(dy) * Math.min(enemy.speed, absDy);
      enemy.direction = dy > 0 ? Direction.Down : Direction.Up;
      enemy.action = PlayerAction.Walk;
    }
  }

  if (distance < tolerance) {
    enemy.position.x += dx;
    enemy.position.y += dy;
    enemy.action = PlayerAction.Idle;
  }
}

function isPlayerInAttackRange(enemy: Character, player: Character): boolean {
  const { dx, dy, distance } = calculateDirection(enemy, player);

  if (distance > enemy.attackRange) {
    return false;
  }

  switch (enemy.direction) {
    case Direction.Up:
      return dy < 0 && Math.abs(dx) < enemy.width / 2;
    case Direction.Down:
      return dy > 0 && Math.abs(dx) < enemy.width / 2;
    case Direction.Left:
      return dx < 0 && Math.abs(dy) < enemy.height / 2;
    case Direction.Right:
      return dx > 0 && Math.abs(dy) < enemy.height / 2;
    default:
      return false;
  }
}

function attackPlayer(enemy: Character, player: Character) {
  player.health -= enemy.attack;
  if (player.health <= 0) {
    respawnPlayer(player as Player);
  }
  updatePlayer(player as Player);
  enemy.action = PlayerAction.Attack;
}

function findClosestPlayer(
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

    if (isPlayerInAttackRange(enemy, closestPlayer)) {
      attackPlayer(enemy, closestPlayer);
    }
  }
}
