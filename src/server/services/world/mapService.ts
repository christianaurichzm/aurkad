import { z } from 'zod';
import { TILE_SIZE } from '../../../shared/constants.js';
import {
  Tile,
  MapStateServer,
  MapType,
  MapOrientation,
  DroppedItem,
  PlayerServer,
  RuntimeNpc,
  Direction,
  CharacterAction,
} from '../../../shared/types.js';
import {
  getMap,
  getPlayer,
  updatePlayer,
  placePlayerOnMap,
} from '../../sim/world.js';
import { runtimeState } from '../../sim/state.js';
import { config } from '../../config.js';

import { emit } from '../../engine/hooks.js';
import GameMapModel from '../../model/Map.js';
import { resendChunkAt } from '../../net/viewerState.js';
import { getNextMapId } from '../dbService.js';
import { getItemById } from '../content/itemService.js';
import { getNpcById } from '../content/npcService.js';
import { onMap, onTiles } from './physicsService.js';
import { resetNpcAi } from '../npc/aiBrain.js';
import { removeNpcFromWorld } from '../npc/spawn.js';
import { ScriptParamsSchema } from '../../../shared/scriptParams.js';

export const MapTypeSchema = z.enum(['pvp', 'normal']);
export const PvpMoraleSchema = z.enum(['safe', 'normal', 'no-penalty']);

const PositionSchema = z.object({ x: z.number(), y: z.number() });

const WarpSchema = z.object({
  to: z.string().min(1),
  position: PositionSchema,
});

const BorderLinkSchema = z.object({
  to: z.string().min(1),
  offset: z.number().int().optional(),
  position: PositionSchema.optional(),
});

export const BorderLinksSchema = z
  .object({
    up: BorderLinkSchema.optional(),
    down: BorderLinkSchema.optional(),
    left: BorderLinkSchema.optional(),
    right: BorderLinkSchema.optional(),
  })
  .optional();

const TileActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('heal') }),
  z.object({ action: z.literal('kill') }),
  z.object({ action: z.literal('message'), text: z.string() }),
  z.object({ action: z.literal('sound'), file: z.string().min(1) }),
  z.object({
    action: z.literal('changeSprite'),
    spriteId: z.number().int().nonnegative(),
  }),
  z.object({
    action: z.literal('script'),
    scriptId: z.string().min(1),
    scriptParams: ScriptParamsSchema.optional(),
  }),
]);

const DoorSchema = z.object({
  requiresItem: z.number().int().nonnegative(),
  openTileIndex: z.number().int().nonnegative(),
});

export const TileSchema = z.object({
  tileIndex: z.number().int().min(-1).default(0),
  blocked: z.boolean().optional(),
  warp: WarpSchema.optional(),
  npcSpawn: z.string().optional(),
  item: z.number().optional(),
  shop: z.string().optional(),
  bank: z.boolean().optional(),
  avoidNpc: z.boolean().optional(),
  fringeIndex: z.number().int().nonnegative().optional(),
  maskIndex: z.number().int().nonnegative().optional(),
  triggers: z.array(TileActionSchema).optional(),
  door: DoorSchema.optional(),
  conditionalBlock: z.string().optional(),
});

const GROUND_ITEM_BOX = { width: TILE_SIZE, height: TILE_SIZE };

/** Whether this process simulates the map: all unless MAP_IDS shards. */
export const ownsMap = (id: string): boolean =>
  !config.instance.mapIds || config.instance.mapIds.includes(id);

export async function getMapById(id: string): Promise<MapStateServer | null> {
  return GameMapModel.findOne({ id }).lean<MapStateServer>().exec();
}

export function createDefaultTiles(cols = 20, rows = 14): Tile[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ tileIndex: -1, blocked: false })),
  );
}

export async function createOrUpdateMap(
  map: Partial<MapStateServer>,
): Promise<string> {
  const id = await saveMap(map);
  // Another instance's map is only stored. In memory here it would be a copy
  // nobody simulates, and a warp would step into it instead of being
  // redirected to the instance that owns it.
  if (ownsMap(id)) await publishMap({ ...map, id });
  return id;
}

/**
 * Writes the map document and leaves the live map alone. What changes the
 * live map comes after this resolves: a world ahead of its document shows an
 * edit the next restart takes back, while whoever saved it was told it failed.
 */
export async function saveMap(map: Partial<MapStateServer>): Promise<string> {
  // A dungeon copy is runtime only; saving one would write a map document
  // whose id nobody can reach, or overwrite the template with whatever one
  // run did to it.
  if (map.id?.includes('#')) {
    throw new Error(`[map] ${map.id} is an instance and cannot be saved`);
  }
  if (!map.id) {
    map.id = (await getNextMapId()).toString();
  }
  await GameMapModel.findOneAndUpdate({ id: map.id }, map, { upsert: true });
  return map.id;
}

/**
 * Writes one tile of a stored map. For a change that belongs in the document
 * while the live grid around it may hold `setMapTile` paint, which saving the
 * whole grid would make permanent.
 */
export async function saveMapTile(
  id: string,
  row: number,
  col: number,
  tile: Tile,
): Promise<void> {
  await GameMapModel.updateOne(
    { id },
    { $set: { [`tiles.${row}.${col}`]: tile } },
  );
}

/** Applies a saved change to the live map. */
async function publishMap(
  map: Partial<MapStateServer> & { id: string },
): Promise<void> {
  const previous = runtimeState.maps[map.id];

  const merged = { ...previous, ...map } as MapStateServer;

  // Whatever toMapMeta sends: a client already on the map is sent it again
  // only for a new revision.
  const staticChanged =
    map.tiles !== undefined ||
    map.name !== undefined ||
    map.type !== undefined ||
    map.pvp !== undefined ||
    map.music !== undefined ||
    map.orientation !== undefined;
  if (staticChanged) {
    merged.tilesRevision = (previous?.tilesRevision ?? 0) + 1;
  }

  runtimeState.maps[map.id] = merged;
  if (map.tiles !== undefined) {
    // An npc on tiles a resize took away is pulled to the nearest edge, like
    // the players below, since off the map nobody can see, reach or fight it.
    // Before the players, whose loop can yield. It takes up its post where it
    // lands, as after a respawn, since the previous post may be off the map.
    for (const npc of Object.values(merged.npcs ?? {})) {
      const position = onMap(npc, map.id, npc.position);
      if (position.x === npc.position.x && position.y === npc.position.y)
        continue;
      npc.position = position;
      resetNpcAi(npc);
    }
    for (const player of Object.values(merged.players ?? {})) {
      const position = onMap(player, map.id, player.position);
      const target = player.targetPosition ?? player.position;
      const next = onMap(player, map.id, target);
      if (
        position.x === player.position.x &&
        position.y === player.position.y &&
        next.x === target.x &&
        next.y === target.y
      )
        continue;
      // Movement reads map services during boot; loading it here avoids
      // entering the tick loop before its movement systems are initialized.
      const { teleportPlayer } = await import('./movementService.js');
      teleportPlayer(player, map.id, position);
      updatePlayer(player);
    }
    emit('mapChange', { mapId: map.id });
  }
}

/**
 * Changes one tile of a live map: the picture on its ground layer, whether
 * it blocks, or both. Runtime only: a restart, an editor save or a content
 * import puts back what was painted, and each copy of an instanced map
 * keeps its own. Everyone on the map gets the tile's chunk again and
 * `mapChange` fires; changing a tile to what it is does neither. False
 * when (col, row) is not on the map or the index is not one.
 */
export function setMapTile(
  mapId: string,
  col: number,
  row: number,
  change: { tileIndex?: number; blocked?: boolean },
): boolean {
  const r = Math.floor(row);
  const c = Math.floor(col);
  const tile = getMap(mapId)?.tiles[r]?.[c];
  if (!tile) return false;
  const tileIndex = change.tileIndex ?? tile.tileIndex;
  if (!Number.isInteger(tileIndex)) return false;
  const blocked = !!(change.blocked ?? tile.blocked);
  if (tileIndex === tile.tileIndex && blocked === !!tile.blocked) return true;

  tile.tileIndex = tileIndex;
  tile.blocked = blocked;
  resendChunkAt(mapId, c, r);
  emit('mapChange', { mapId });
  return true;
}

export async function listMaps(): Promise<MapStateServer[]> {
  return GameMapModel.find().lean<MapStateServer[]>().exec();
}

/**
 * The live map with the editor's grid in it. The editor sends the whole
 * grid, and the map has moved on since it loaded (npcs fought and wandered,
 * players dropped things, scripts spawned pets), so the save applies what
 * the grid changed and keeps the rest.
 */
export const insertModeCell = (
  live: MapStateServer,
  tiles: Tile[][],
  spawned: Record<string, RuntimeNpc>,
): MapStateServer => {
  // A drop on tiles a resize took away goes to the nearest edge rather than
  // out of the economy.
  for (const drop of live.droppedItems) {
    drop.position = onTiles(GROUND_ITEM_BOX, tiles, drop.position);
  }
  return {
    ...live,
    tiles,
    npcs: keepLiveNpcs(live, spawned),
    droppedItems: [
      ...live.droppedItems,
      ...newlyPlacedItems(live.tiles, tiles),
    ],
  };
};

/**
 * Each spawn tile names its npc (`map:template:row:col`), so one already
 * live stays as the game left it, and one whose tile is gone or spawns
 * something else goes. A script's npc has no tile and is not the editor's
 * to remove. A known spawn with no live npc is a kill awaiting respawn,
 * which brings it back on its own schedule.
 */
const keepLiveNpcs = (
  live: MapStateServer | undefined,
  spawned: Record<string, RuntimeNpc>,
): Record<string, RuntimeNpc> => {
  const npcs: Record<string, RuntimeNpc> = {};
  for (const npc of Object.values(live?.npcs ?? {})) {
    if (!npc.templateId || spawned[npc.id]) npcs[npc.id] = npc;
  }
  for (const npc of Object.values(spawned)) {
    if (npcs[npc.id]) continue;
    // insertNpcs stands each npc on the tile that spawned it.
    const row = npc.position.y / TILE_SIZE;
    const col = npc.position.x / TILE_SIZE;
    if (live?.tiles[row]?.[col]?.npcSpawn === npc.templateId) continue;
    npcs[npc.id] = npc;
  }
  return npcs;
};

export const mapSave = async (
  mapId: string,
  tiles: Tile[][],
  name: string,
  type: MapType,
  music?: string,
  orientation?: MapOrientation,
) => {
  const spawned: Partial<MapStateServer> = {};
  await insertNpcs(spawned, mapId, tiles);

  // Not live here: another instance runs it under MAP_IDS, or there is no such
  // map. Written to the document alone, the edit would be undone by the next
  // write of the instance that holds the map in memory.
  const before = getMap(mapId);
  if (!before) {
    throw new Error(`[map] ${mapId} is not running on this instance`);
  }
  const saved = {
    id: mapId,
    name,
    type,
    pvp: before.pvp,
    orientation: orientation || before.orientation,
    tiles,
    music,
    instanced: before.instanced,
    borderLinks: before.borderLinks,
  };
  await saveMap(saved);

  // Read after the save, and nothing awaits until the map is live: the tick
  // ran meanwhile, and the save keeps a kill or a pick-up in between.
  const live = getMap(mapId)!;
  const merged = insertModeCell(live, tiles, spawned.npcs ?? {});
  runtimeState.maps[mapId] = merged;
  // After the swap, so a handler of the removal that spawns on this map
  // spawns on the map that stays.
  for (const npc of Object.values(live.npcs)) {
    if (merged.npcs[npc.id] !== npc) removeNpcFromWorld(npc, merged);
  }
  await publishMap(saved);
};

/**
 * Items the editor placed on tiles that did not hold them before. A
 * placement the map already had went on the ground with its own save and
 * may be in someone's bag; saving the map again is no reason for another.
 */
const newlyPlacedItems = (
  before: Tile[][] | undefined,
  tiles: Tile[][],
): DroppedItem[] => {
  const droppedItems: DroppedItem[] = [];

  for (let rowIndex = 0; rowIndex < tiles.length; rowIndex++) {
    const row = tiles[rowIndex]!;
    for (let colIndex = 0; colIndex < row.length; colIndex++) {
      const tile = row[colIndex]!;
      if (tile.item && before?.[rowIndex]?.[colIndex]?.item !== tile.item) {
        const item = getItemById(tile.item);
        if (!item) continue;

        droppedItems.push({
          itemId: item.id,
          sprite: item.sprite,
          position: {
            x: colIndex * TILE_SIZE,
            y: rowIndex * TILE_SIZE,
          },
          quantity: 1,
        });
      }
    }
  }
  return droppedItems;
};

const tileSized = (value: number | undefined) =>
  Number.isFinite(value) && (value as number) > 0
    ? (value as number)
    : TILE_SIZE;

export const insertNpcs = async (
  partialMap: Partial<MapStateServer>,
  mapId: string,
  tiles: Tile[][],
) => {
  const npcs: Record<string, RuntimeNpc> = {};

  const npcCache = new Map<string, RuntimeNpc | null>();

  for (let rowIndex = 0; rowIndex < tiles.length; rowIndex++) {
    const row = tiles[rowIndex]!;
    for (let colIndex = 0; colIndex < row.length; colIndex++) {
      const tile = row[colIndex]!;
      const npcId = tile.npcSpawn;
      if (!npcId) continue;

      if (!npcCache.has(npcId)) {
        const base = await getNpcById(npcId);
        if (!base) {
          npcCache.set(npcId, null);
        } else {
          npcCache.set(npcId, {
            ...base,
            // The stored document is whatever wrote it (a content
            // pack, a hand-edited collection), and a box narrower
            // than a tile makes the health bar miss the sprite and
            // puts the tile next door out of melee reach. spawnNpc
            // normalises the same way.
            width: tileSized(base.width),
            height: tileSized(base.height),
            attackRange: tileSized(base.attackRange),
            health: base.maxHealth,
            position: { x: 0, y: 0 },
            mapId,
            direction: Direction.Down,
            action: CharacterAction.Idle,
            kind: 'npc',
          });
        }
      }

      const baseNpc = npcCache.get(npcId);
      if (!baseNpc) continue;

      // The map is in the id because replication keys its diff history by id
      // alone: the same template on the same tile of two maps would otherwise
      // be one entity to every viewer.
      const instanceId = `${mapId}:${npcId}:${rowIndex}:${colIndex}`;
      const runtimeNpc: RuntimeNpc = {
        ...baseNpc,
        id: instanceId,
        templateId: npcId,
        position: {
          x: colIndex * TILE_SIZE,
          y: rowIndex * TILE_SIZE,
        },
      };

      npcs[instanceId] = runtimeNpc;
    }
  }

  partialMap.npcs = npcs;
};

export const updatePlayerMap = (
  _playerId: string,
  newState: PlayerServer,
  previousMapId?: string,
) => {
  placePlayerOnMap(newState, previousMapId);
};

export const addPlayerOnMap = (playerId: string) => {
  const player = getPlayer(playerId);
  if (!player) return;
  return placePlayerOnMap(player);
};
