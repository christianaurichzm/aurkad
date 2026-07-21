import {
  Direction,
  PlayerServer,
  RuntimeNpc,
  MapStateServer,
} from '../../../shared/types.js';
import { TILE_SIZE } from '../../../shared/constants.js';
import { getMap } from './gameData.js';
import { queryEntitiesInRadius } from '../../spatial/spatialManager.js';
import { emit } from '../../engine/hooks.js';

// "Talk to the NPC you're facing". Mirrors combat target selection for any
// npc, whatever its behavior, and emits the npcInteract hook so scripts
// decide what happens (dialog, shop, quest).

function isFacing(player: PlayerServer, npc: RuntimeNpc): boolean {
  switch (player.direction) {
    case Direction.Up:
      return npc.position.y < player.position.y;
    case Direction.Down:
      return npc.position.y > player.position.y;
    case Direction.Left:
      return npc.position.x < player.position.x;
    case Direction.Right:
      return npc.position.x > player.position.x;
    default:
      return false;
  }
}

export function findInteractTarget(
  player: PlayerServer,
  map: MapStateServer,
): RuntimeNpc | undefined {
  const nearby = queryEntitiesInRadius(
    player.mapId,
    player.position.x,
    player.position.y,
    TILE_SIZE,
  );

  for (const entity of nearby) {
    if (!entity.id) continue;
    const npc = map.npcs[entity.id];
    if (!npc || npc.health <= 0) continue;
    if (!isFacing(player, npc)) continue;
    return npc;
  }
  return undefined;
}

export function handleInteract(player: PlayerServer): void {
  const map = getMap(player.mapId);
  if (!map) return;
  const npc = findInteractTarget(player, map);
  if (npc) emit('npcInteract', { player, npc });
}
