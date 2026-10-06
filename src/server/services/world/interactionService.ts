import {
  PlayerServer,
  RuntimeNpc,
  MapStateServer,
} from '../../../shared/types.js';
import { TILE_SIZE } from '../../../shared/constants.js';
import { canInteract } from '../../../shared/utils.js';
import { getMap } from './gameData.js';
import { queryEntitiesInRadius } from '../../sim/spatialManager.js';
import { emit } from '../../engine/hooks.js';
import { dispatchEntityScript } from '../../engine/scripting/entityScripts.js';

// "Talk to the NPC you're facing". Mirrors combat target selection for any
// npc, whatever its behavior, and emits the npcInteract hook so scripts
// decide what happens (dialog, shop, quest).

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

  // The index answers with a box that overlaps each entity's own, which
  // reaches further up and left than down and right; canInteract is the reach.
  for (const entity of nearby) {
    if (!entity.id) continue;
    const npc = map.npcs[entity.id];
    if (npc && canInteract(player, npc)) return npc;
  }
  return undefined;
}

export function handleInteract(player: PlayerServer): void {
  const map = getMap(player.mapId);
  if (!map) return;
  const npc = findInteractTarget(player, map);
  if (!npc) return;
  emit('npcInteract', { player, npc });
  // The hook fires first so global listeners (modules) still see every
  // interaction; the attached behaviour then runs for this npc specifically.
  dispatchEntityScript(
    npc.scriptId,
    'onInteract',
    { player, npc },
    npc.scriptParams,
  );
}
