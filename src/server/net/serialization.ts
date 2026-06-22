import type {
  DroppedItem,
  MapDynamicClient,
  MapStateClient,
  MapStaticClient,
  MapStateServer,
  PlayerPublic,
  PlayerServer,
  Position,
  RuntimeNpc,
} from '../../shared/types.js';

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
    position: player.position,
    targetPosition: player.targetPosition,
    direction: player.direction,
    action: player.action,
    nameColor: player.nameColor,
    nameTag: player.nameTag,
    kind: 'player',
  };
}

function withinInterestRadius(
  viewerPos: Position,
  targetPos: Position,
  interestRadiusPx: number,
) {
  if (interestRadiusPx <= 0) return true;
  return (
    Math.abs(targetPos.x - viewerPos.x) <= interestRadiusPx &&
    Math.abs(targetPos.y - viewerPos.y) <= interestRadiusPx
  );
}

export function toMapStaticClient(map: MapStateServer): MapStaticClient {
  return {
    id: map.id,
    name: map.name,
    type: map.type,
    pvp: map.pvp,
    tiles: map.tiles,
  };
}

export function toMapDynamicClient(
  map: MapStateServer,
  viewer: PlayerServer,
  interestRadiusPx: number,
): MapDynamicClient {
  const viewerPos = viewer.position;

  const players = Object.fromEntries(
    Object.entries(map.players).flatMap(([id, other]) => {
      if (id === viewer.id) return [];
      if (!withinInterestRadius(viewerPos, other.position, interestRadiusPx))
        return [];
      return [[id, toPlayerPublic(other)]] as const;
    }),
  );

  const npcs = Object.fromEntries(
    Object.entries(map.npcs).flatMap(([id, npc]) => {
      if (!withinInterestRadius(viewerPos, npc.position, interestRadiusPx))
        return [];
      return [[id, npc]] as const;
    }),
  ) as Record<string, RuntimeNpc>;

  const droppedItems = map.droppedItems.filter((item: DroppedItem) =>
    withinInterestRadius(viewerPos, item.position, interestRadiusPx),
  );

  return {
    id: map.id,
    droppedItems,
    npcs,
    players,
  };
}

export function toMapStateClient(
  map: MapStateServer,
  viewer: PlayerServer,
  interestRadiusPx: number,
): MapStateClient {
  return {
    ...toMapStaticClient(map),
    ...toMapDynamicClient(map, viewer, interestRadiusPx),
  };
}
