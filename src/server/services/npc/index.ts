import { TILE_SIZE } from '../../../shared/constants.js';
import { randomPick } from '../../sim/rng.js';
import {
  MapStateServer,
  Position,
  CharacterAction,
  RuntimeNpc,
  PlayerServer,
} from '../../../shared/types.js';
import { getMap, getRuntimeState } from '../../sim/world.js';
import { getOrInitNpcAi, transitionNpcAi, resetNpcAi } from './aiBrain.js';
import { isHunter, type NpcAiState } from './types.js';
import { getTick, msToTicks } from '../../sim/clock.js';
import { scheduleAfter } from '../../sim/scheduler.js';
import { indexPlacement } from '../../sim/spatialManager.js';
import { dueNpcs, putNpcInWorld, removeNpcFromWorld } from './spawn.js';
import { gameConfig } from '../../gameConfig.js';
import {
  findClosestPlayer,
  isPlayerInAttackRange,
  attackPlayer,
  stepNpcToward,
  moveNpcRandomly,
  faceToward,
  escapeMove,
} from './behaviors.js';
import { useApi } from '../../engine/modules/registry.js';
import { logger } from '../../logger.js';
import { isInstanceTemplate } from '../world/instanceService.js';

const STUCK_ESCAPE_TICKS = 2;

// Sight in tiles when the npc does not declare one. Aggressive hunts by scent
// (no line of sight, wide radius); hostile only reacts to what it can see.
const DEFAULT_SIGHT_TILES: Record<string, number> = {
  aggressive: 8,
  hostile: 4,
};

// How far from its post an npc follows a target before giving up. 0 on
// the npc means no rope at all: a boss that hunts you across the map.
const DEFAULT_LEASH_TILES = 12;

// A hostile npc idles by wandering, and this is the patch it wanders inside.
// Without it the random walk carries it away from its spawn for good.
const WANDER_RADIUS_TILES = 3;

// Distance in tiles along the longest axis, so the leash and the patrol patch
// are squares around the post. Cheaper than the real walking distance and the
// same shape the box query already draws around an npc.
const tilesApart = (a: Position, b: Position): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) / TILE_SIZE;

const sightPx = (npc: RuntimeNpc): number =>
  (npc.sight ?? DEFAULT_SIGHT_TILES[npc.behavior] ?? 0) * TILE_SIZE;

type LosApi = {
  hasLOS: (from: Position, to: Position, map: MapStateServer) => boolean;
};

// With the player in attack range, attack (cooldown ready) or wait in
// place. False only when out of range, the chase's cue.
function attackInRange(
  npc: RuntimeNpc,
  player: PlayerServer,
  ai: NpcAiState,
): boolean {
  if (!isPlayerInAttackRange(npc, player)) return false;
  const tick = getTick();
  const cooldownTicks = msToTicks(gameConfig.combat.npcAttackCooldownMs);
  if (tick - ai.lastAttackTick >= cooldownTicks) {
    transitionNpcAi(ai, 'attack');
    ai.lastAttackTick = tick;
    attackPlayer(npc, player);
  } else {
    npc.action = CharacterAction.Idle;
  }
  return true;
}

// One step toward a destination, with an escape hatch for the step the path
// could not know about: a player standing on the tile it wants. Shared by the
// chase and the walk home, which get stuck the same way.
function stepWithEscape(
  npc: RuntimeNpc,
  ai: NpcAiState,
  destination: Position,
  map: MapStateServer,
) {
  stepNpcToward(npc, { position: destination }, map);
  if (npc.action === CharacterAction.Walk) {
    ai.stuckTicks = 0;
    return;
  }
  ai.stuckTicks += 1;
  if (ai.stuckTicks >= STUCK_ESCAPE_TICKS) {
    ai.stuckTicks = 0;
    escapeMove(npc);
  }
}

// ---- target acquisition ----

// The npc has been hit: that attacker is the target, sight and walls be
// damned. Otherwise it notices whoever is closest inside its sight radius,
// which for a hostile also means in plain view.
function resolveTarget(
  npc: RuntimeNpc,
  ai: NpcAiState,
  map: MapStateServer,
): PlayerServer | null {
  const leash = npc.leash ?? DEFAULT_LEASH_TILES;
  if (leash > 0 && tilesApart(npc.position, ai.home) >= leash) {
    ai.aggroPlayerId = undefined;
    return null;
  }
  // Walking home is a commitment: re-acquiring on the way back is how an npc
  // gets kited in place, one step out and one step in, forever.
  if (ai.state === 'return') return null;

  if (ai.aggroPlayerId) {
    const attacker = map.players[ai.aggroPlayerId];
    if (attacker && attacker.health > 0) return attacker;
    // Dead, disconnected or gone to another map.
    ai.aggroPlayerId = undefined;
  }

  const closest = findClosestPlayer(npc, map, sightPx(npc));
  if (!closest || npc.behavior !== 'hostile') return closest;

  const los = useApi<LosApi>('los');
  return !los || los.hasLOS(npc.position, closest.position, map)
    ? closest
    : null;
}

// Nothing to fight. An npc kept wherever the last chase left it drifts
// from where the map put it, and after a few hours every aggressive npc
// stands somewhere random.
function idleStep(npc: RuntimeNpc, ai: NpcAiState, map: MapStateServer) {
  const wanderRadius = npc.behavior === 'hostile' ? WANDER_RADIUS_TILES : 0;

  if (tilesApart(npc.position, ai.home) > wanderRadius) {
    transitionNpcAi(ai, 'return');
    stepWithEscape(npc, ai, ai.home, map);
    return;
  }

  // Back on its patch: provokable again (the 'return' deafness ends here).
  if (npc.behavior === 'hostile') {
    transitionNpcAi(ai, 'wander');
    moveNpcRandomly(npc);
    return;
  }
  transitionNpcAi(ai, 'idle');
  npc.action = CharacterAction.Idle;
}

// ---- public API ----

export const respawnNpc = (mapId: string, npc: RuntimeNpc) => {
  // Even an npc with no respawn time is gone for a tick. Moved in place, one
  // that rises a tile from where it fell reads to a viewer as a step, and is
  // drawn walking there instead of appearing.
  const delay = Math.max(1, npc.respawnMs ? msToTicks(npc.respawnMs) : 0);

  // Off the map is what makes it dead to everything at once: the quadtree,
  // targeting, collision and the ai all walk map.npcs, and a viewer is sent
  // the id as gone. Replication forgets it because the id comes back, and
  // a returning entity is sent whole, not diffed against the corpse. With no
  // spawn tile, which is every npc a script spawned, it stays gone.
  removeNpcFromWorld(npc, getMap(mapId));
  scheduleAfter(delay, () => {
    // The map is looked up again: a save in the editor replaces the map
    // object, and can put a new npc on this id's spawn tile meanwhile.
    const current = getMap(mapId);
    if (!current || current.npcs[npc.id]) return;
    if (placeAtSpawn(mapId, npc)) putNpcInWorld(current, npc);
  });
};

function placeAtSpawn(mapId: string, npc: RuntimeNpc): boolean {
  const map = getMap(mapId);
  if (!map) return false;

  const positions = findNpcSpawnPositions(map, npc.templateId ?? npc.id);
  const newPosition = randomPick(positions);
  if (!newPosition) return false;

  npc.health = npc.maxHealth;
  npc.position = newPosition;
  npc.action = CharacterAction.Idle;
  indexPlacement(map, npc);

  resetNpcAi(npc);
  return true;
}

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
  if (!isHunter(npc.behavior)) {
    npc.action = CharacterAction.Idle;
    return;
  }

  // Before the early return below: the ai state carries the post this npc
  // walks back to, and walking back is what it does when there is no target.
  const ai = getOrInitNpcAi(npc);

  const target = resolveTarget(npc, ai, map);
  if (!target) {
    idleStep(npc, ai, map);
    return;
  }

  // Orient toward the player before checking attack range so a stale facing
  // direction never delays the first hit by a full update interval.
  faceToward(npc, target);

  // Both hunting behaviors do the same from here: attack what is in range,
  // otherwise close the distance. What separates aggressive from hostile is
  // acquisition (sight radius and line of sight), done above.
  if (!attackInRange(npc, target, ai)) {
    transitionNpcAi(ai, 'chase');
    stepWithEscape(npc, ai, target.position, map);
  }
}

/**
 * The npc tick system: the npcs whose turn this tick is, on every map. Each
 * has a tick of its own within its interval (dueNpcs), so a map's npcs share
 * the interval's ticks rather than all thinking on one of them.
 */
export function updateDueNpcs(): void {
  const tick = getTick();
  for (const map of Object.values(getRuntimeState().maps)) {
    if (isInstanceTemplate(map)) continue;
    for (const npc of dueNpcs(map, tick)) {
      // One npc's failure stays its own: a throw out of this loop would
      // freeze every npc after it, on every map, every tick. The decision
      // calls module code (a line-of-sight provider), so a fault here may not
      // be the engine's.
      try {
        updateNpcs(npc, map);
      } catch (err) {
        logger.errorThrottled('npc', '[npc] update failed', {
          npcId: npc.id,
          mapId: map.id,
          err,
        });
      }
    }
  }
}
