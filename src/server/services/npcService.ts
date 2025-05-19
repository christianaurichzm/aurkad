import { TILE_SIZE } from '../../shared/constants';
import { getRandomPosition } from '../../shared/utils';
import {
  Character,
  Npc,
  MapStateServer,
  Position,
  Direction,
  PlayerAction,
  PlayerServer,
} from '../../shared/types';
import { getMap, updatePlayer } from '../gameData';
import { hasCollision } from './physicsService';
import { respawnPlayer } from './playerService';

import NpcModel from '../model/Npc';

export async function getNpcById(id: string): Promise<Npc | null> {
  return await NpcModel.findOne({ id }).lean<Npc>().exec();
}

export async function createOrUpdateNpc(npc: Npc): Promise<void> {
  await NpcModel.findOneAndUpdate({ id: npc.id }, npc, { upsert: true });
}

export async function deleteNpc(id: string): Promise<void> {
  await NpcModel.deleteOne({ id });
}

export async function listNpcs(): Promise<Npc[]> {
  return await NpcModel.find().lean<Npc[]>().exec();
}

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
  map: MapStateServer,
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
    respawnPlayer(player as PlayerServer);
  }
  updatePlayer(player as PlayerServer);
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

function moveNpcRandomly(npc: Npc, map: MapStateServer) {
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

export function updateNpcs(npc: Npc, map: MapStateServer) {
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
