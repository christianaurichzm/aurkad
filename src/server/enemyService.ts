import { TILE_SIZE } from '../shared/constants';
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
  enemy.position.x = Math.floor(Math.random() * 12) * 64;
  enemy.position.y = Math.floor(Math.random() * 8) * 64;
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

function moveEnemyTowardsPlayer(
  enemy: Character,
  player: Character,
  map: MapState,
) {
  const { dx, dy } = calculateDirection(enemy, player);

  let newX = enemy.position.x;
  let newY = enemy.position.y;

  if (Math.abs(dx) > Math.abs(dy)) {
    newX += Math.sign(dx) * TILE_SIZE;
    enemy.direction = dx > 0 ? Direction.Right : Direction.Left;

    if (
      hasCollision({ ...enemy, position: { x: newX, y: enemy.position.y } })
    ) {
      newX = enemy.position.x;
      newY += Math.sign(dy) * TILE_SIZE;
      enemy.direction = dy > 0 ? Direction.Down : Direction.Up;
    }
  } else {
    newY += Math.sign(dy) * TILE_SIZE;
    enemy.direction = dy > 0 ? Direction.Down : Direction.Up;

    if (
      hasCollision({ ...enemy, position: { x: enemy.position.x, y: newY } })
    ) {
      newY = enemy.position.y;
      newX += Math.sign(dx) * TILE_SIZE;
      enemy.direction = dx > 0 ? Direction.Right : Direction.Left;
    }
  }

  const proposedPosition = { ...enemy, position: { x: newX, y: newY } };

  if (!hasCollision(proposedPosition)) {
    enemy.position.x = newX;
    enemy.position.y = newY;
    enemy.action = PlayerAction.Walk;
  } else {
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
      return dy < 0 && Math.abs(dx) < player.width / 2;
    case Direction.Down:
      return dy > 0 && Math.abs(dx) < player.width / 2;
    case Direction.Left:
      return dx < 0 && Math.abs(dy) < player.height / 2;
    case Direction.Right:
      return dx > 0 && Math.abs(dy) < player.height / 2;
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
  if (closestPlayer) {
    moveEnemyTowardsPlayer(enemy, closestPlayer, map);

    if (isPlayerInAttackRange(enemy, closestPlayer)) {
      attackPlayer(enemy, closestPlayer);
    }
  }
}
