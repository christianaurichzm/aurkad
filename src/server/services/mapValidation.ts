import { Tile } from '../../shared/types.js';
import { mapPixelWidth, mapPixelHeight } from '../../shared/mapGeometry.js';
import { getMapById, listMaps } from './mapService.js';
import { listNpcs } from './npc/index.js';
import { listItems } from './inventoryService.js';
import { listShops } from './shopService.js';

export interface MapValidationResult {
  errors: string[];
  warnings: string[];
}

export function resizeTiles(
  tiles: Tile[][],
  newCols: number,
  newRows: number,
): Tile[][] {
  return Array.from({ length: newRows }, (_, r) =>
    Array.from(
      { length: newCols },
      (_, c) => tiles[r]?.[c] ?? { tileIndex: -1, blocked: false },
    ),
  );
}

export async function validateMapTiles(
  tiles: Tile[][],
): Promise<MapValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!tiles.length) return { errors, warnings };

  // Rectangular check
  const colCount = tiles[0]?.length ?? 0;
  const nonRectRows = tiles.filter((row) => row.length !== colCount);
  if (nonRectRows.length > 0) {
    errors.push(
      `Map is not rectangular: ${nonRectRows.length} row(s) have ${colCount} expected columns.`,
    );
  }

  // Collect referenced IDs
  const warpTargets = new Map<string, Array<{ x: number; y: number }>>();
  const npcIds = new Set<string>();
  const itemIds = new Set<number>();
  const shopIds = new Set<string>();

  for (const row of tiles) {
    for (const tile of row) {
      if (tile.warp) {
        const list = warpTargets.get(tile.warp.to) ?? [];
        list.push(tile.warp.position);
        warpTargets.set(tile.warp.to, list);
      }
      if (tile.npcSpawn) npcIds.add(tile.npcSpawn);
      if (tile.item != null) itemIds.add(tile.item);
      if (tile.shop) shopIds.add(tile.shop);
    }
  }

  const [maps, npcs, items, shops] = await Promise.all([
    listMaps(),
    listNpcs(),
    listItems(),
    listShops(),
  ]);

  const mapIdSet = new Set(maps.map((m) => m.id));
  const npcIdSet = new Set(npcs.map((n) => String(n.id)));
  const itemIdSet = new Set(items.map((i) => i.id));
  const shopIdSet = new Set(shops.map((s) => s.id));

  // Warp validation
  for (const [targetId, positions] of warpTargets) {
    if (!mapIdSet.has(targetId)) {
      warnings.push(`Warp references unknown map "${targetId}".`);
      continue;
    }
    const targetMap = await getMapById(targetId);
    if (targetMap?.tiles) {
      const maxX = mapPixelWidth(targetMap.tiles);
      const maxY = mapPixelHeight(targetMap.tiles);
      for (const pos of positions) {
        if (pos.x < 0 || pos.y < 0 || pos.x >= maxX || pos.y >= maxY) {
          errors.push(
            `Warp to "${targetId}" at (${pos.x},${pos.y}) is outside map bounds (${maxX}×${maxY}px).`,
          );
        }
      }
    }
  }

  for (const id of npcIds) {
    if (!npcIdSet.has(id))
      warnings.push(`NPC spawn references unknown NPC "${id}".`);
  }
  for (const id of itemIds) {
    if (!itemIdSet.has(id))
      warnings.push(`Item tile references unknown item ID ${id}.`);
  }
  for (const id of shopIds) {
    if (!shopIdSet.has(id))
      warnings.push(`Shop tile references unknown shop "${id}".`);
  }

  return { errors, warnings };
}
