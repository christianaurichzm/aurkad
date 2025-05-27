import { TILE_SIZE } from '../../shared/constants.js';
import { getRandomPosition } from '../../shared/utils.js';
import {
  MapStateServer,
  Position,
  Direction,
  CharacterAction,
  PlayerServer,
  RuntimeNpc,
  PersistentNpc,
} from '../../shared/types.js';
import { getMap, runtimeState, updatePlayer } from '../gameData.js';
import { hasCollision } from './physicsService.js';
import { respawnPlayer } from './playerService.js';
import NpcModel from '../model/Npc.js';
import { getNextNpcId } from './dbService.js';

export async function getNpcById(id: string): Promise<PersistentNpc | null> {
  return await NpcModel.findOne({ id }).lean<PersistentNpc>().exec();
}

export async function createOrUpdateNpc(
  npc: Partial<PersistentNpc>,
): Promise<void> {
  if (!npc.id) {
    npc.id = (await getNextNpcId()).toString();
  }

  await NpcModel.findOneAndUpdate({ id: npc.id }, npc, {
    upsert: true,
  });
}

export async function updateNpcAll(
  id: string,
  updates: Partial<PersistentNpc>,
): Promise<PersistentNpc | undefined> {
  if (!id) return;

  const updated = await NpcModel.findOneAndUpdate(
    { id },
    { $set: updates },
    { new: true },
  )
    .lean<PersistentNpc>()
    .exec();

  refreshNpcInRuntime(id);

  return updated || undefined;
}

export async function refreshNpcInRuntime(id: string): Promise<void> {
  const updated = await getNpcById(id);
  if (!updated) return;

  for (const map of Object.values(runtimeState.maps)) {
    for (const [runtimeId, npc] of Object.entries(map.npcs)) {
      if (npc.id === id) {
        map.npcs[runtimeId] = {
          ...map.npcs[runtimeId],
          ...updated,
          health: updated.maxHealth,
          action: CharacterAction.Idle,
        };
      }
    }
  }
}

export async function deleteNpc(id: string): Promise<void> {
  await NpcModel.deleteOne({ id });
}

export async function listNpcs(): Promise<PersistentNpc[]> {
  return await NpcModel.find().lean<PersistentNpc[]>().exec();
}

export const respawnNpc = (mapId: string, npc: RuntimeNpc) => {
  const map = getMap(mapId);
  if (!map) return;

  const positions = findNpcSpawnPositions(map, npc.id);
  const newPosition = getRandomPosition(positions);
  if (!newPosition) return;

  npc.health = npc.maxHealth;
  npc.position = newPosition;
  npc.action = CharacterAction.Idle;
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

function calculateDirection(
  from: { position: Position },
  to: { position: Position },
) {
  const dx = to.position.x - from.position.x;
  const dy = to.position.y - from.position.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  return { dx, dy, distance };
}

function isPlayerInAttackRange(npc: RuntimeNpc, player: PlayerServer): boolean {
  const { dx, dy, distance } = calculateDirection(npc, player);

  if (distance > npc.attackRange) return false;

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

function attackPlayer(npc: RuntimeNpc, player: PlayerServer) {
  player.health -= npc.attack;
  if (player.health <= 0) {
    respawnPlayer(player);
  }
  updatePlayer(player);
  npc.action = CharacterAction.Attack;
}

function findClosestPlayer(
  npc: RuntimeNpc,
  players: PlayerServer[],
): PlayerServer | null {
  let closest: PlayerServer | null = null;
  let minDistance = Infinity;

  for (const player of players) {
    const { distance } = calculateDirection(npc, player);
    if (distance < minDistance) {
      minDistance = distance;
      closest = player;
    }
  }

  return closest;
}

function moveNpcTowardsPlayer(npc: RuntimeNpc, player: PlayerServer) {
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

  const proposed = { ...npc, position: { x: newX, y: newY } };
  if (!hasCollision(proposed)) {
    npc.position = proposed.position;
    npc.action = CharacterAction.Walk;
  } else {
    npc.action = CharacterAction.Idle;
  }

  if (dx === 0) {
    npc.direction = dy > 0 ? Direction.Down : Direction.Up;
  } else if (dy === 0) {
    npc.direction = dx > 0 ? Direction.Right : Direction.Left;
  }
}

function moveNpcRandomly(npc: RuntimeNpc) {
  const directions = [
    { dx: 0, dy: -TILE_SIZE, dir: Direction.Up },
    { dx: 0, dy: TILE_SIZE, dir: Direction.Down },
    { dx: -TILE_SIZE, dy: 0, dir: Direction.Left },
    { dx: TILE_SIZE, dy: 0, dir: Direction.Right },
  ];

  const { dx, dy, dir } =
    directions[Math.floor(Math.random() * directions.length)];
  const newX = npc.position.x + dx;
  const newY = npc.position.y + dy;

  const proposed = { ...npc, position: { x: newX, y: newY } };
  if (!hasCollision(proposed)) {
    npc.position = proposed.position;
    npc.direction = dir;
    npc.action = CharacterAction.Walk;
  } else {
    npc.action = CharacterAction.Idle;
  }
}

export function updateNpcs(npc: RuntimeNpc, map: MapStateServer) {
  if (npc.behavior === 'neutral') {
    npc.action = CharacterAction.Idle;
    return;
  }

  const closestPlayer = findClosestPlayer(npc, Object.values(map.players));
  if (!closestPlayer) return;

  const canAttack = isPlayerInAttackRange(npc, closestPlayer);

  if (npc.behavior === 'aggressive') {
    canAttack
      ? attackPlayer(npc, closestPlayer)
      : moveNpcTowardsPlayer(npc, closestPlayer);
  }

  if (npc.behavior === 'hostile') {
    canAttack ? attackPlayer(npc, closestPlayer) : moveNpcRandomly(npc);
  }
}
