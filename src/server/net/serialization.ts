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
import { type Viewport } from '../../shared/mapGeometry.js';

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

function withinViewport(pos: Position, vp: Viewport): boolean {
  return (
    pos.x >= vp.left &&
    pos.x <= vp.right &&
    pos.y >= vp.top &&
    pos.y <= vp.bottom
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
  viewport: Viewport,
): MapDynamicClient {
  const players = Object.fromEntries(
    Object.entries(map.players).flatMap(([id, other]) => {
      if (id === viewer.id) return [];
      if (!withinViewport(other.position, viewport)) return [];
      return [[id, toPlayerPublic(other)]] as const;
    }),
  );

  const npcs = Object.fromEntries(
    Object.entries(map.npcs).flatMap(([id, npc]) => {
      if (!withinViewport(npc.position, viewport)) return [];
      return [[id, npc]] as const;
    }),
  ) as Record<string, RuntimeNpc>;

  const droppedItems = map.droppedItems.filter((item: DroppedItem) =>
    withinViewport(item.position, viewport),
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
  viewport: Viewport,
): MapStateClient {
  return {
    ...toMapStaticClient(map),
    ...toMapDynamicClient(map, viewer, viewport),
  };
}
