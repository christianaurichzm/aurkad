import type {
  MapStateServer,
  PlayerServer,
  Position,
  RuntimeNpc,
} from '../../../shared/types.js';
import { TILE_SIZE } from '../../../shared/constants.js';
import { gameConfig } from '../../gameConfig.js';
import { emit } from '../../engine/hooks.js';
import { logger } from '../../logger.js';
import { runtimeState } from '../../sim/state.js';
import { getTick, msToTicks } from '../../sim/clock.js';
import { randomInt } from '../../sim/rng.js';
import { scheduleEvery } from '../../sim/scheduler.js';
import { dropQuadtree } from '../../sim/spatialManager.js';
import { forgetReplicatedEntity } from '../../net/snapshot.js';
import { forgetNpcAiForMap } from '../npc/aiBrain.js';
import { clearDamageContributions } from '../combat/damage.js';
import { getMap } from '../../sim/world.js';

/**
 * A dungeon is a copy of a map, not a map of its own. Everything keyed by
 * map takes any string (npcs, quadtree, interest sets, chunk cache, map
 * chat), so a private copy of map `7` is the same map under the key
 * `7#a3f2`, built from the same document.
 *
 * What this owns is the copy's three answers: which copy a player gets
 * (the owner's, so a party arrives together), when it stops existing
 * (empty, plus a grace so a dropped connection returns to the same run),
 * and where the player really is for anything that outlives the copy, as
 * a key gone tomorrow must never reach their document.
 */

const SEPARATOR = '#';

type Instance = {
  templateId: string;
  owner: string;
  /** Tick the last player left, or undefined while somebody is inside. */
  emptySince?: number;
};

const instances = new Map<string, Instance>();
const byOwner = new Map<string, string>();

/** playerId -> where they were standing when they walked in. */
const entrances = new Map<string, { mapId: string; position: Position }>();

/**
 * The map a copy is made from, as opposed to a copy (which carries the flag
 * too, spread from it). Its npcs are the blueprint each new copy starts
 * from. Edits keep them current like any map's, and nothing plays there,
 * since an instanced map is only entered through a copy, so the npc update
 * skips a template.
 */
export function isInstanceTemplate(map: MapStateServer): boolean {
  return map.instanced === true && !isInstanceKey(map.id);
}

/**
 * Whether this map is entered as a copy. The flag is on the map document,
 * so every door gets the same answer; a map both public and private would
 * be a meeting place and a blueprint at once. False for a map this process
 * lacks, so the caller falls back to its cross-instance redirect, and for
 * a copy, which carries its template's flag but is the room itself: a warp
 * to it (a GM going to a player inside) lands there.
 */
export function isInstancedMap(mapId: string): boolean {
  const map = getMap(mapId);
  return map !== undefined && isInstanceTemplate(map);
}

export function isInstanceKey(mapId?: string): boolean {
  // Tolerates a player without a map: this is read on the way to a session's
  // last write, the shutdown sweep included, and a throw there costs saves.
  return mapId?.includes(SEPARATOR) ?? false;
}

/**
 * Which copy this player belongs to. The engine's answer is "their own", as
 * a solo dungeon needs no agreement. Anything grouping players (a party, a
 * guild raid, a queue) answers the `instanceOwner` hook with a name for the
 * group, and everyone with the same answer walks into the same copy.
 */
function ownerFor(player: PlayerServer, templateId: string): string {
  const payload = { player, mapId: templateId, owner: player.name };
  emit('instanceOwner', payload);
  return payload.owner || player.name;
}

function createInstance(templateId: string, owner: string): string | undefined {
  const template = getMap(templateId);
  if (!template) {
    logger.warn('[instance] template map is not loaded here', { templateId });
    return undefined;
  }

  // Rolled on the simulation's sequence: different from one boot to the next,
  // and the same in a replay of this one, where the npcs of the copy have to
  // come back under the ids they had.
  let key: string;
  do {
    const suffix = randomInt(0x1000000).toString(16).padStart(6, '0');
    key = `${templateId}${SEPARATOR}${suffix}`;
  } while (runtimeState.maps[key]);
  const npcs: Record<string, RuntimeNpc> = {};
  for (const npc of Object.values(template.npcs)) {
    // The id carries the map, because the replication cache is keyed by entity
    // id alone: two copies of one dungeon with the same npc ids would inherit
    // each other's diff history.
    const id = `${key}:${npc.id}`;
    npcs[id] = {
      ...npc,
      id,
      mapId: key,
      position: { ...npc.position },
      health: npc.maxHealth,
    };
  }

  const copy: MapStateServer = {
    ...template,
    id: key,
    // Each copy its own tiles, one object per tile: a door a script opens
    // with setMapTile is changed in place, and is a door in this copy only.
    tiles: template.tiles.map((row) => row.map((t) => ({ ...t }))),
    players: {},
    npcs,
    droppedItems: [],
  };

  runtimeState.maps[key] = copy;
  instances.set(key, { templateId, owner, emptySince: getTick() });
  byOwner.set(`${templateId}${SEPARATOR}${owner}`, key);
  logger.info('[instance] opened', { map: key, owner });
  return key;
}

/**
 * The copy this player is walking into, made if it is not there yet.
 * Returns the map key to teleport to, or undefined when the template is not
 * on this process: a sharded deployment keeps an instanced map and its
 * copies together, and the caller falls back to its redirect.
 */
export function enterInstance(
  player: PlayerServer,
  templateId: string,
): string | undefined {
  const owner = ownerFor(player, templateId);
  const ownerKey = `${templateId}${SEPARATOR}${owner}`;

  const existing = byOwner.get(ownerKey);
  const key = existing ?? createInstance(templateId, owner);
  if (!key) return undefined;

  // Where they came from, for anything that outlives the copy. Taken before
  // the teleport, and only on the way in: walking from one room of a dungeon
  // to another must not overwrite the way out.
  if (!isInstanceKey(player.mapId)) {
    entrances.set(player.id, {
      mapId: player.mapId,
      position: { ...player.position },
    });
  }

  instances.get(key)!.emptySince = undefined;
  return key;
}

/** Players with a way out of a copy recorded, published as a metric. */
export function entranceCount(): number {
  return entrances.size;
}

/** Dropped when a player leaves for a map that is not a copy. */
export function forgetEntrance(playerId: string): void {
  entrances.delete(playerId);
}

/**
 * Where a player is, as far as their document is concerned. An instance key
 * means nothing tomorrow: the copy is gone, and a document pointing at it
 * logs in to a map that does not exist. The doorway they came in through is
 * written instead, so logging back in puts them at the entrance, and
 * walking in lands them in the same copy while it is open.
 */
export function persistedLocation(player: PlayerServer): {
  mapId: string;
  position: Position;
} {
  if (!isInstanceKey(player.mapId)) {
    return { mapId: player.mapId, position: player.position };
  }

  const entrance = entrances.get(player.id);
  return (
    entrance ?? {
      mapId: gameConfig.world.startMapId,
      position: {
        x: gameConfig.world.respawnTile.col * TILE_SIZE,
        y: gameConfig.world.respawnTile.row * TILE_SIZE,
      },
    }
  );
}

function closeInstance(key: string): void {
  const map = runtimeState.maps[key];
  if (map) {
    // Its npcs go with it, and so does everything kept under their ids: a
    // copy's ids are never handed out again, so nothing would clear it later.
    for (const npc of Object.values(map.npcs)) {
      forgetReplicatedEntity(npc.id);
      clearDamageContributions(npc.id);
    }
    delete runtimeState.maps[key];
  }
  forgetNpcAiForMap(key);
  dropQuadtree(key);

  const instance = instances.get(key);
  if (instance) {
    byOwner.delete(`${instance.templateId}${SEPARATOR}${instance.owner}`);
    instances.delete(key);
  }
  logger.info('[instance] closed', { map: key });
}

/**
 * Closes copies nobody is in. The grace makes a dropped connection
 * survivable: a player reconnecting walks in through the same door, which
 * leads back to the same run while the copy is open.
 */
export function sweepInstances(): void {
  const graceTicks = msToTicks(gameConfig.world.instanceGraceMs);
  const now = getTick();

  for (const [key, instance] of instances) {
    const empty =
      Object.keys(runtimeState.maps[key]?.players ?? {}).length === 0;
    if (!empty) {
      instance.emptySince = undefined;
      continue;
    }
    if (instance.emptySince === undefined) {
      instance.emptySince = now;
      continue;
    }
    if (now - instance.emptySince >= graceTicks) closeInstance(key);
  }
}

/** Called at boot, once the maps are loaded and before anyone can walk in. */
export function startInstances(): void {
  scheduleEvery(msToTicks(1_000), sweepInstances, 'instances');
}

/** Test seam: the three maps above are process state, like every cache. */
export function clearInstancesForTest(): void {
  for (const key of [...instances.keys()]) closeInstance(key);
  entrances.clear();
}
