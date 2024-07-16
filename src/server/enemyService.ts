import { TILE_SIZE } from '../shared/constants';
import { getRandomPosition } from '../shared/utils';
import {
  Character,
  Direction,
  Enemy,
  MapState,
  Player,
  PlayerAction,
  Position,
} from '../shared/types';
import { getMap, updatePlayer } from './database';
import { hasCollision } from './gameService';
import { respawnPlayer } from './playerService';

function calculateDirection(
  from: Character,
  to: Character,
): { dx: number; dy: number; distance: number } {
  const dx = to.position.x - from.position.x;
  const dy = to.position.y - from.position.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  return { dx, dy, distance };
}

export const respawnEnemy = (mapId: string, enemy: Enemy) => {
  const map = getMap(mapId);
  if (!map) return;
  const positionsEnemy = findEnemySpawnPositions(map, enemy.id);

  const newPosition = getRandomPosition(positionsEnemy);

  if (!newPosition) return;

  enemy.health = 100;
  enemy.position = newPosition;
};

export const findEnemySpawnPositions = (
  map: MapState,
  enemyId: string,
): Position[] => {
  const positions: Position[] = [];

  map.tiles.forEach((row, rowIndex) => {
    row.forEach((tile, colIndex) => {
      if (tile.enemySpawn === enemyId) {
        positions.push({
          x: colIndex * TILE_SIZE,
          y: rowIndex * TILE_SIZE,
        });
      }
    });
  });

  return positions;
};

function moveEnemyTowardsPlayer(enemy: Character, player: Character) {
  const { dx, dy } = calculateDirection(enemy, player);

  let newX = enemy.position.x;
  let newY = enemy.position.y;

  if (Math.abs(dx) > Math.abs(dy)) {
    newX += Math.sign(dx) * TILE_SIZE;
    if (
      !hasCollision({ ...enemy, position: { x: newX, y: enemy.position.y } })
    ) {
      enemy.direction = dx > 0 ? Direction.Right : Direction.Left;
    } else {
      newX = enemy.position.x;
      newY += Math.sign(dy) * TILE_SIZE;
      if (
        !hasCollision({ ...enemy, position: { x: enemy.position.x, y: newY } })
      ) {
        enemy.direction = dy > 0 ? Direction.Down : Direction.Up;
      } else {
        newY = enemy.position.y;
      }
    }
  } else {
    newY += Math.sign(dy) * TILE_SIZE;
    if (
      !hasCollision({ ...enemy, position: { x: enemy.position.x, y: newY } })
    ) {
      enemy.direction = dy > 0 ? Direction.Down : Direction.Up;
    } else {
      newY = enemy.position.y;
      newX += Math.sign(dx) * TILE_SIZE;
      if (
        !hasCollision({ ...enemy, position: { x: newX, y: enemy.position.y } })
      ) {
        enemy.direction = dx > 0 ? Direction.Right : Direction.Left;
      } else {
        newX = enemy.position.x;
      }
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

  if (dx === 0) {
    enemy.direction = dy > 0 ? Direction.Down : Direction.Up;
  } else if (dy === 0) {
    enemy.direction = dx > 0 ? Direction.Right : Direction.Left;
  }
}

function isPlayerInAttackRange(enemy: Character, player: Character): boolean {
  const { dx, dy, distance } = calculateDirection(enemy, player);

  if (distance > enemy.attackRange) {
    return false;
  }

  switch (enemy.direction) {
    case Direction.Up:
      return dy < 0 && Math.abs(dx) < player.width;
    case Direction.Down:
      return dy > 0 && Math.abs(dx) < player.width;
    case Direction.Left:
      return dx < 0 && Math.abs(dy) < player.height;
    case Direction.Right:
      return dx > 0 && Math.abs(dy) < player.height;
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
    if (isPlayerInAttackRange(enemy, closestPlayer)) {
      attackPlayer(enemy, closestPlayer);
    } else {
      moveEnemyTowardsPlayer(enemy, closestPlayer);
    }
  }
}
