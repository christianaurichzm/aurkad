/**
 * Spatial manager: maintains quadtrees for efficient spatial queries,
 * reducing collision detection from O(n²) to O(log n).
 */

import { Quadtree, QuadtreeEntity } from '../../shared/spatial/Quadtree.js';
import { GAME_WIDTH, GAME_HEIGHT } from '../../shared/constants.js';
import { MapStateServer, CombatTarget } from '../../shared/types.js';

// Cache quadtrees per map
const mapQuadtrees = new Map<string, Quadtree>();

/**
 * Get or create quadtree for a map
 */
function getQuadtree(mapId: string): Quadtree {
  let quadtree = mapQuadtrees.get(mapId);
  if (!quadtree) {
    quadtree = new Quadtree(
      { x: 0, y: 0, width: GAME_WIDTH, height: GAME_HEIGHT },
      10, // maxEntities per node
      8, // maxDepth
    );
    mapQuadtrees.set(mapId, quadtree);
  }
  return quadtree;
}

/**
 * Convert CombatTarget to QuadtreeEntity
 */
function toQuadtreeEntity(target: CombatTarget): QuadtreeEntity {
  return {
    id: target.id,
    position: target.position,
    width: target.width,
    height: target.height,
  };
}

/**
 * Rebuild quadtree for a map
 * Call this each tick before physics checks
 */
export function rebuildQuadtree(mapId: string, map: MapStateServer): void {
  const quadtree = getQuadtree(mapId);
  quadtree.clear();

  // Insert all players
  for (const player of Object.values(map.players)) {
    quadtree.insert(toQuadtreeEntity(player));
  }

  // Insert all NPCs
  for (const npc of Object.values(map.npcs)) {
    if (npc.health > 0) {
      // Only insert live NPCs
      quadtree.insert(toQuadtreeEntity(npc));
    }
  }
}

/**
 * Query entities that could collide with the given character
 * Returns only nearby entities instead of ALL entities
 */
export function queryNearbyEntities(character: CombatTarget): QuadtreeEntity[] {
  if (!character.mapId) return [];

  const quadtree = mapQuadtrees.get(character.mapId);
  if (!quadtree || quadtree.size() === 0) return [];

  // Query slightly larger area to catch entities on borders
  const padding = 10;
  const queryArea = {
    x: character.position.x - padding,
    y: character.position.y - padding,
    width: character.width + padding * 2,
    height: character.height + padding * 2,
  };

  return quadtree.query(queryArea);
}

/**
 * Query entities within a radius (for NPC AI)
 */
export function queryEntitiesInRadius(
  mapId: string,
  x: number,
  y: number,
  radius: number,
): QuadtreeEntity[] {
  const quadtree = mapQuadtrees.get(mapId);
  if (!quadtree || quadtree.size() === 0) return [];
  return quadtree.queryRadius({ x, y }, radius);
}

/**
 * Get quadtree statistics for monitoring/debugging
 */
export function getQuadtreeStats(mapId: string) {
  const quadtree = mapQuadtrees.get(mapId);
  if (!quadtree) return null;
  return quadtree.getStats();
}

/**
 * Clear all quadtrees (for cleanup)
 */
export function clearAllQuadtrees(): void {
  mapQuadtrees.clear();
}
