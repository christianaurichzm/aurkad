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
  PlayerServer,
} from '../../../shared/types.js';
import { getMap } from '../../gameData.js';
import { getOrInitNpcAi, transitionNpcAi, resetNpcAi } from './aiBrain.js';
import type { NpcAiState } from './types.js';
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
import { selector, sequence, cond, act, type BtNode } from './bt.js';
import { useApi } from '../../engine/modules/registry.js';

const STUCK_ESCAPE_TICKS = 2;
const HOSTILE_NOTICE_RADIUS_SQ = (TILE_SIZE * 4) ** 2;

type LosApi = {
  hasLOS: (from: Position, to: Position, map: MapStateServer) => boolean;
};

type NpcBtCtx = {
  npc: RuntimeNpc;
  player: PlayerServer;
  map: MapStateServer;
  ai: NpcAiState;
  tick: number;
  attackCooldownTicks: number;
};

// ---- shared leaf nodes ----

// If player is in attack range, either attack (cooldown ready) or idle-wait in
// position. Returns 'failure' only when out of range, letting the selector fall
// through to the chase branch.
const inRangeHandler: BtNode<NpcBtCtx> = (ctx) => {
  if (!isPlayerInAttackRange(ctx.npc, ctx.player)) return 'failure';
  if (ctx.tick - ctx.ai.lastAttackTick >= ctx.attackCooldownTicks) {
    transitionNpcAi(ctx.ai, 'attack');
    ctx.ai.lastAttackTick = ctx.tick;
    attackPlayer(ctx.npc, ctx.player);
  } else {
    ctx.npc.action = CharacterAction.Idle;
  }
  return 'success';
};

const chaseWithStuck: BtNode<NpcBtCtx> = act((ctx) => {
  transitionNpcAi(ctx.ai, 'chase');
  moveNpcTowardsPlayer(ctx.npc, ctx.player, ctx.map);
  if (ctx.npc.action === CharacterAction.Walk) {
    ctx.ai.stuckTicks = 0;
  } else {
    ctx.ai.stuckTicks += 1;
    if (ctx.ai.stuckTicks >= STUCK_ESCAPE_TICKS) {
      ctx.ai.stuckTicks = 0;
      escapeMove(ctx.npc);
    }
  }
});

// Succeeds when the player is within the hostile notice radius AND (if the LOS
// module is loaded) has a clear line of sight.
const playerInSight: BtNode<NpcBtCtx> = cond((ctx) => {
  const { distanceSq } = calculateDirection(ctx.npc, ctx.player);
  if (distanceSq > HOSTILE_NOTICE_RADIUS_SQ) return false;
  const los = useApi<LosApi>('los');
  return !los || los.hasLOS(ctx.npc.position, ctx.player.position, ctx.map);
});

const doWander: BtNode<NpcBtCtx> = act((ctx) => {
  transitionNpcAi(ctx.ai, 'wander');
  moveNpcRandomly(ctx.npc);
});

// ---- behavior trees (built once, reused every tick) ----

// aggressive: always chases; attacks on cooldown when in range.
const aggressiveBt: BtNode<NpcBtCtx> = selector(inRangeHandler, chaseWithStuck);

// hostile: patrols (wanders), notices players within 4 tiles (LOS-aware),
// chases when spotted, attacks in range. Reacts to proximity, doesn't hunt.
const hostileBt: BtNode<NpcBtCtx> = selector(
  inRangeHandler,
  sequence(playerInSight, chaseWithStuck),
  doWander,
);

// ---- public API ----

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

export function updateNpcs(
  npc: RuntimeNpc,
  map: MapStateServer,
  livePlayers: PlayerServer[],
) {
  if (
    npc.behavior === 'neutral' ||
    npc.behavior === 'friendly' ||
    npc.behavior === 'shopkeeper' ||
    npc.behavior === 'guard'
  ) {
    npc.action = CharacterAction.Idle;
    return;
  }

  const closestPlayer = findClosestPlayer(npc, livePlayers);
  if (!closestPlayer) {
    npc.action = CharacterAction.Idle;
    return;
  }

  // Orient toward the player before checking attack range so a stale facing
  // direction never delays the first hit by a full update interval.
  faceToward(npc, closestPlayer);

  const ai = getOrInitNpcAi(npc);
  const tick = getTick();
  const attackCooldownTicks = msToTicks(gameConfig.combat.npcAttackCooldownMs);
  const ctx: NpcBtCtx = {
    npc,
    player: closestPlayer,
    map,
    ai,
    tick,
    attackCooldownTicks,
  };

  if (npc.behavior === 'aggressive') {
    aggressiveBt(ctx);
  } else if (npc.behavior === 'hostile') {
    hostileBt(ctx);
  }
}
