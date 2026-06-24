export {
  getNpcById,
  createOrUpdateNpc,
  updateNpcAll,
  refreshNpcInRuntime,
  deleteNpc,
  listNpcs,
} from './persistenceOps.js';

import { TILE_SIZE } from '../../../shared/constants.js';
import { randomPick } from '../../sim/rng.js';
import {
  MapStateServer,
  Position,
  CharacterAction,
  RuntimeNpc,
} from '../../../shared/types.js';
import { getMap } from '../../gameData.js';
import { getOrInitNpcAi, transitionNpcAi, resetNpcAi } from './aiBrain.js';
import { getTick, msToTicks } from '../../sim/clock.js';
import { gameConfig } from '../../gameConfig.js';
import {
  findClosestPlayer,
  isPlayerInAttackRange,
  attackPlayer,
  moveNpcTowardsPlayer,
  moveNpcRandomly,
  faceToward,
  escapeMove,
  calculateDirection,
} from './behaviors.js';

// Consecutive stuck ticks before attempting an escape move.
const STUCK_ESCAPE_TICKS = 2;
// Hostile NPCs switch from wander to chase when a player enters this radius.
const HOSTILE_NOTICE_RADIUS_SQ = (TILE_SIZE * 4) ** 2;

export const respawnNpc = (mapId: string, npc: RuntimeNpc) => {
  const map = getMap(mapId);
  if (!map) return;

  const positions = findNpcSpawnPositions(map, npc.templateId ?? npc.id);
  const newPosition = randomPick(positions);
  if (!newPosition) return;

  npc.health = npc.maxHealth;
  npc.position = newPosition;
  npc.action = CharacterAction.Idle;

  resetNpcAi(npc);
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

export function updateNpcs(npc: RuntimeNpc, map: MapStateServer) {
  if (
    npc.behavior === 'neutral' ||
    npc.behavior === 'friendly' ||
    npc.behavior === 'shopkeeper' ||
    npc.behavior === 'guard'
  ) {
    npc.action = CharacterAction.Idle;
    return;
  }

  const livePlayers = Object.values(map.players).filter(
    (player) => player.health > 0,
  );

  const closestPlayer = findClosestPlayer(npc, livePlayers);
  if (!closestPlayer) {
    npc.action = CharacterAction.Idle;
    return;
  }

  // Orient toward the player before checking attack range so a stale facing
  // direction never delays the first hit by a full update interval.
  faceToward(npc, closestPlayer);

  const canAttack = isPlayerInAttackRange(npc, closestPlayer);
  const ai = getOrInitNpcAi(npc);
  const tick = getTick();
  const ATTACK_COOLDOWN_TICKS = msToTicks(
    gameConfig.combat.npcAttackCooldownMs,
  );

  if (npc.behavior === 'aggressive') {
    transitionNpcAi(ai, canAttack ? 'attack' : 'chase');

    if (ai.state === 'attack') {
      if (tick - ai.lastAttackTick >= ATTACK_COOLDOWN_TICKS) {
        ai.lastAttackTick = tick;
        attackPlayer(npc, closestPlayer);
      } else {
        npc.action = CharacterAction.Idle;
      }
    } else {
      moveNpcTowardsPlayer(npc, closestPlayer, map);
      if (npc.action === CharacterAction.Walk) {
        ai.stuckTicks = 0;
      } else {
        ai.stuckTicks += 1;
        if (ai.stuckTicks >= STUCK_ESCAPE_TICKS) {
          ai.stuckTicks = 0;
          escapeMove(npc);
        }
      }
    }
  }

  if (npc.behavior === 'hostile') {
    const { distanceSq } = calculateDirection(npc, closestPlayer);
    const inNoticeRadius = distanceSq <= HOSTILE_NOTICE_RADIUS_SQ;

    transitionNpcAi(
      ai,
      canAttack ? 'attack' : inNoticeRadius ? 'chase' : 'wander',
    );

    if (ai.state === 'attack') {
      if (tick - ai.lastAttackTick >= ATTACK_COOLDOWN_TICKS) {
        ai.lastAttackTick = tick;
        attackPlayer(npc, closestPlayer);
      } else {
        npc.action = CharacterAction.Idle;
      }
    } else if (ai.state === 'chase') {
      moveNpcTowardsPlayer(npc, closestPlayer, map);
      if (npc.action === CharacterAction.Walk) {
        ai.stuckTicks = 0;
      } else {
        ai.stuckTicks += 1;
        if (ai.stuckTicks >= STUCK_ESCAPE_TICKS) {
          ai.stuckTicks = 0;
          escapeMove(npc);
        }
      }
    } else {
      moveNpcRandomly(npc);
    }
  }
}
