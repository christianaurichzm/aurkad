import type {
  EquippedItemsDetailed,
  InventoryItemDetailed,
  MapChunkPayload,
  MapMetaClient,
  MapStateServer,
  Player,
  PlayerCold,
  PlayerHot,
  PlayerPublic,
  PlayerServer,
  RuntimeNpc,
  Tile,
  TilePublic,
} from '../../shared/types.js';
import { mapTileWidth, mapTileHeight } from '../../shared/mapGeometry.js';
import { CHUNK_SIZE, EQUIPMENT_SLOTS } from '../../shared/constants.js';
import { config } from '../config.js';
import { npcMoveTicks } from '../services/npc/types.js';
import { getItemById } from '../services/content/itemService.js';

// Server -> client shaping for the live wire format: entity public state, the
// hot/cold halves of a player's own state, map metadata, and tile chunks.

export function toPlayerPublic(player: PlayerServer): PlayerPublic {
  return {
    id: player.id,
    name: player.name,
    sprite: player.sprite,
    width: player.width,
    height: player.height,
    maxHealth: player.maxHealth,
    health: player.health,
    level: player.level,
    access: player.access,
    position: { ...player.position },
    targetPosition: player.targetPosition
      ? { ...player.targetPosition }
      : undefined,
    direction: player.direction,
    action: player.action,
    nameColor: player.nameColor,
    nameTag: player.nameTag,
    nameTagColor: player.nameTagColor,
    kind: 'player',
  };
}

export function toMapMeta(map: MapStateServer): MapMetaClient {
  return {
    id: map.id,
    name: map.name,
    type: map.type,
    pvp: map.pvp,
    orientation: map.orientation,
    cols: mapTileWidth(map.tiles),
    rows: mapTileHeight(map.tiles),
    revision: map.tilesRevision ?? 0,
    music: map.music,
  };
}

// Named rather than inlined so the list of what a player may know about a tile
// is one thing to read. A field added to `Tile` does not join it by default,
// which is the point: the last one that did was a script trigger.
function toTilePublic(tile: Tile): TilePublic {
  return {
    tileIndex: tile.tileIndex,
    maskIndex: tile.maskIndex,
    fringeIndex: tile.fringeIndex,
  };
}

export function toMapChunk(
  map: MapStateServer,
  chunkX: number,
  chunkY: number,
): MapChunkPayload {
  const rowStart = chunkY * CHUNK_SIZE;
  const colStart = chunkX * CHUNK_SIZE;
  const tiles = map.tiles
    .slice(rowStart, rowStart + CHUNK_SIZE)
    .map((row) => row.slice(colStart, colStart + CHUNK_SIZE).map(toTilePublic));
  return {
    mapId: map.id,
    revision: map.tilesRevision ?? 0,
    chunkX,
    chunkY,
    tiles,
  };
}

// Positions are copied so the broadcast state never aliases the live entity
// (the sim mutates it in place every tick).
export function toNpcPublic(npc: RuntimeNpc): RuntimeNpc {
  // scriptParams is the behaviour's server-side config: no client reads it,
  // and as an object it would be stringified for every npc's delta every
  // tick. The ai tuning beside it is server-side too, read over REST.
  const {
    scriptParams: _scriptParams,
    sight: _sight,
    pathDepth: _pathDepth,
    leash: _leash,
    respawnMs: _respawnMs,
    solid: _solid,
    ...rest
  } = npc;
  return {
    ...rest,
    // The time a step actually takes, default and tick rounding applied: the
    // client slides a step over it, so an npc walks at its own pace instead of
    // covering the tile at a player's and standing until the next step.
    moveIntervalMs: npcMoveTicks(npc) * (1000 / config.gameLoop.tickRate),
    position: { ...npc.position },
    targetPosition: npc.targetPosition ? { ...npc.targetPosition } : undefined,
  };
}

export function toPlayerHot(player: PlayerServer): PlayerHot {
  return {
    id: player.id,
    position: { ...player.position },
    targetPosition: player.targetPosition
      ? { ...player.targetPosition }
      : undefined,
    moving: player.moving,
    moveTick: player.moveTick,
    moveDurationTicks: player.moveDurationTicks,
    direction: player.direction,
    action: player.action,
    health: player.health,
    lastProcessedSeq: player.lastProcessedSeq,
  };
}

export function toPlayerCold(player: PlayerServer): PlayerCold {
  // An id the catalogue no longer has (deleted in the editor, lost to a
  // restore, skipped at boot as malformed) is left out, never thrown on or
  // dropped: every stats payload, login and purchase crosses here, and the
  // entry itself survives, so recreating the item under that id returns it to
  // whoever held it.
  // The hidden entry still takes an inventory slot the player can neither see
  // nor empty; freeing it would take deleteItem stripping it from holders.
  const inventory: InventoryItemDetailed[] = [];
  for (const entry of player.inventory?.items ?? []) {
    const item = getItemById(entry.item);
    if (item) inventory.push({ item, quantity: entry.quantity });
  }

  const equippedSource = player.equipped ?? {};
  const equipped: EquippedItemsDetailed = {};
  for (const slot of EQUIPMENT_SLOTS) {
    const itemId = equippedSource[slot];
    if (itemId) {
      const item = getItemById(itemId);
      if (item) equipped[slot] = item;
    }
  }

  return {
    id: player.id,
    name: player.name,
    sprite: player.sprite,
    width: player.width,
    height: player.height,
    maxHealth: player.maxHealth,
    attack: player.attack,
    attackRange: player.attackRange,
    level: player.level,
    experience: player.experience,
    experienceToNextLevel: player.experienceToNextLevel,
    inventory,
    inventoryCapacity: player.inventory?.maxCapacity ?? 0,
    equipped,
    access: player.access,
    strength: player.strength,
    defense: player.defense,
    agility: player.agility,
    vitality: player.vitality,
    unspentPoints: player.unspentPoints,
    speed: player.speed,
    mapId: player.mapId,
    nameColor: player.nameColor,
    nameTag: player.nameTag,
    nameTagColor: player.nameTagColor,
    kind: 'player',
  };
}

export function enrichPlayer(player: PlayerServer): Player {
  return {
    ...toPlayerCold(player),
    ...toPlayerHot(player),
  };
}
