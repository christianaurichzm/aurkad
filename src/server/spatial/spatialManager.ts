import { Quadtree, QuadtreeEntity } from '../../shared/spatial/Quadtree.js';
import { mapPixelWidth, mapPixelHeight } from '../../shared/mapGeometry.js';
import { MapStateServer, CombatTarget } from '../../shared/types.js';

const mapQuadtreeInfo = new Map<
  string,
  { qt: Quadtree; w: number; h: number }
>();

function getOrCreateQuadtree(mapId: string, w: number, h: number): Quadtree {
  const cached = mapQuadtreeInfo.get(mapId);
  if (cached && cached.w === w && cached.h === h) return cached.qt;
  const qt = new Quadtree({ x: 0, y: 0, width: w, height: h }, 10, 8);
  mapQuadtreeInfo.set(mapId, { qt, w, h });
  return qt;
}

function toQuadtreeEntity(target: CombatTarget): QuadtreeEntity {
  return {
    id: target.id,
    kind: target.kind,
    position: target.position,
    width: target.width,
    height: target.height,
  };
}

export function rebuildQuadtree(mapId: string, map: MapStateServer): void {
  const w = mapPixelWidth(map.tiles);
  const h = mapPixelHeight(map.tiles);
  const quadtree = getOrCreateQuadtree(mapId, w, h);
  quadtree.clear();

  for (const player of Object.values(map.players)) {
    quadtree.insert(toQuadtreeEntity(player));
  }

  for (const npc of Object.values(map.npcs)) {
    if (npc.health > 0) {
      quadtree.insert(toQuadtreeEntity(npc));
    }
  }
}

export function queryNearbyEntities(character: CombatTarget): QuadtreeEntity[] {
  if (!character.mapId) return [];
  const info = mapQuadtreeInfo.get(character.mapId);
  if (!info || info.qt.size() === 0) return [];
  const padding = 10;
  return info.qt.query({
    x: character.position.x - padding,
    y: character.position.y - padding,
    width: character.width + padding * 2,
    height: character.height + padding * 2,
  });
}

export function queryEntitiesInRadius(
  mapId: string,
  x: number,
  y: number,
  radius: number,
): QuadtreeEntity[] {
  const info = mapQuadtreeInfo.get(mapId);
  if (!info || info.qt.size() === 0) return [];
  return info.qt.queryRadius({ x, y }, radius);
}

export function getQuadtreeStats(mapId: string) {
  const info = mapQuadtreeInfo.get(mapId);
  return info?.qt.getStats() ?? null;
}

export function clearAllQuadtrees(): void {
  mapQuadtreeInfo.clear();
}
