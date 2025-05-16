import { TILE_SIZE } from '../shared/constants';
import { getRandomPosition } from '../shared/utils';
import {
  Character,
  Direction,
  Npc,
  MapState,
  Player,
  PlayerAction,
  Position,
} from '../shared/types';
import { getMap, updatePlayer } from './database';
import { hasCollision } from './gameService';
import { respawnPlayer } from './playerService';

export const isNpc = (char: Character): char is Npc => {
  return 'behavior' in char;
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

export const respawnNpc = (mapId: string, npc: Npc) => {
  const map = getMap(mapId);
  if (!map) return;
  const positionsNpc = findNpcSpawnPositions(map, npc.id);

  const newPosition = getRandomPosition(positionsNpc);

  if (!newPosition) return;

  npc.health = npc.maxHealth;
  npc.position = newPosition;
};

export const findNpcSpawnPositions = (
  map: MapState,
  npcId: string,
): Position[] => {
  const positions: Position[] = [];

  map.tiles.forEach((row, rowIndex) => {
    row.forEach((tile, colIndex) => {
      if (tile.npcSpawn === npcId) {
        positions.push({
          x: colIndex * TILE_SIZE,
          y: rowIndex * TILE_SIZE,
        });
      }
    });
  });

  return positions;
};

function moveNpcTowardsPlayer(npc: Character, player: Character) {
  const { dx, dy } = calculateDirection(npc, player);

  let newX = npc.position.x;
  let newY = npc.position.y;

  if (Math.abs(dx) > Math.abs(dy)) {
    newX += Math.sign(dx) * TILE_SIZE;
    if (!hasCollision({ ...npc, position: { x: newX, y: npc.position.y } })) {
      npc.direction = dx > 0 ? Direction.Right : Direction.Left;
    } else {
      newX = npc.position.x;
      newY += Math.sign(dy) * TILE_SIZE;
      if (!hasCollision({ ...npc, position: { x: npc.position.x, y: newY } })) {
        npc.direction = dy > 0 ? Direction.Down : Direction.Up;
      } else {
        newY = npc.position.y;
      }
    }
  } else {
    newY += Math.sign(dy) * TILE_SIZE;
    if (!hasCollision({ ...npc, position: { x: npc.position.x, y: newY } })) {
      npc.direction = dy > 0 ? Direction.Down : Direction.Up;
    } else {
      newY = npc.position.y;
      newX += Math.sign(dx) * TILE_SIZE;
      if (!hasCollision({ ...npc, position: { x: newX, y: npc.position.y } })) {
        npc.direction = dx > 0 ? Direction.Right : Direction.Left;
      } else {
        newX = npc.position.x;
      }
    }
  }

  const proposedPosition = { ...npc, position: { x: newX, y: newY } };

  if (!hasCollision(proposedPosition)) {
    npc.position.x = newX;
    npc.position.y = newY;
    npc.action = PlayerAction.Walk;
  } else {
    npc.action = PlayerAction.Idle;
  }

  if (dx === 0) {
    npc.direction = dy > 0 ? Direction.Down : Direction.Up;
  } else if (dy === 0) {
    npc.direction = dx > 0 ? Direction.Right : Direction.Left;
  }
}

function isPlayerInAttackRange(npc: Character, player: Character): boolean {
  const { dx, dy, distance } = calculateDirection(npc, player);

  if (distance > npc.attackRange) {
    return false;
  }

  switch (npc.direction) {
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

function attackPlayer(npc: Character, player: Character) {
  player.health -= npc.attack;
  if (player.health <= 0) {
    respawnPlayer(player as Player);
  }
  updatePlayer(player as Player);
  npc.action = PlayerAction.Attack;
}

function findClosestPlayer(
  npc: Character,
  players: Character[],
): Character | null {
  let closestPlayer: Character | null = null;
  let shortestDistance = Infinity;

  players.forEach((player) => {
    const { distance } = calculateDirection(npc, player);

    if (distance < shortestDistance) {
      shortestDistance = distance;
      closestPlayer = player;
    }
  });

  return closestPlayer;
}

function moveNpcRandomly(npc: Npc, map: MapState) {
  const directions = [
    { dx: 0, dy: -TILE_SIZE, dir: Direction.Up },
    { dx: 0, dy: TILE_SIZE, dir: Direction.Down },
    { dx: -TILE_SIZE, dy: 0, dir: Direction.Left },
    { dx: TILE_SIZE, dy: 0, dir: Direction.Right },
  ];

  const randomDirection =
    directions[Math.floor(Math.random() * directions.length)];

  const newX = npc.position.x + randomDirection.dx;
  const newY = npc.position.y + randomDirection.dy;

  const proposed = { ...npc, position: { x: newX, y: newY } };

  if (!hasCollision(proposed)) {
    npc.position = proposed.position;
    npc.direction = randomDirection.dir;
    npc.action = PlayerAction.Walk;
  } else {
    npc.action = PlayerAction.Idle;
  }
}

export function updateNpcs(npc: Npc, map: MapState) {
  if (npc.behavior === 'neutral') {
    npc.action = PlayerAction.Idle;
    return;
  }

  const closestPlayer = findClosestPlayer(npc, Object.values(map.players));
  if (!closestPlayer) return;

  const canAttack = isPlayerInAttackRange(npc, closestPlayer);

  if (npc.behavior === 'aggressive') {
    if (canAttack) {
      attackPlayer(npc, closestPlayer);
    } else {
      moveNpcTowardsPlayer(npc, closestPlayer);
    }
  }

  if (npc.behavior === 'hostile') {
    if (canAttack) {
      attackPlayer(npc, closestPlayer);
    } else {
      moveNpcRandomly(npc, map);
    }
  }
}
