// Referential integrity across content collections. Each collection
// validates its own shape, but a shop selling an item that does not exist
// saves fine and fails only when a player opens it. mapValidation.ts does
// this for map tiles; this covers references outside tiles. As there, a
// dangling reference is a WARNING (it loads and the creator is told), and a
// problem that makes data silently unrecoverable is an ERROR.

export interface ContentValidationResult {
  errors: string[];
  warnings: string[];
}

interface ItemRef {
  id: number;
  name?: string;
  scriptId?: string | undefined;
}
// id is optional because the editor validates a document before it is saved,
// and ids for new documents are assigned on persist.
interface NpcRef {
  id?: string;
  name?: string;
  itemsToDrop?: Array<{ itemId: number }> | undefined;
  scriptId?: string | undefined;
}
interface ShopRef {
  id?: string;
  name?: string;
  products?: Array<{ itemId: number }> | undefined;
}
interface TileRef {
  triggers?: Array<{ action: string; scriptId?: string }> | undefined;
}
interface MapRef {
  id?: string;
  name?: string;
  droppedItems?: Array<{ itemId: number }> | undefined;
  tiles?: TileRef[][] | undefined;
}

export interface ContentGraph {
  items?: ItemRef[];
  npcs?: NpcRef[];
  shops?: ShopRef[];
  maps?: MapRef[];
}

function label(id: string | undefined, name?: string): string {
  if (!id) return name ? `"${name}"` : '(unsaved)';
  return name && name !== id ? `"${id}" (${name})` : `"${id}"`;
}

/** Reports duplicate ids, which upsert silently collapses into one document. */
function checkDuplicateIds(
  kind: string,
  entries: Array<{ id?: string | number }> | undefined,
  errors: string[],
): void {
  if (!entries) return;
  const seen = new Set<string>();
  const reported = new Set<string>();
  for (const entry of entries) {
    if (entry.id === undefined) continue;
    const key = String(entry.id);
    if (seen.has(key) && !reported.has(key)) {
      reported.add(key);
      errors.push(
        `Duplicate ${kind} id "${key}": later entries overwrite earlier ones.`,
      );
    }
    seen.add(key);
  }
}

/**
 * Reports content naming a behaviour no script registered: a `script` tile
 * naming nothing would save clean and be ignored at runtime. Separate from
 * `validateContentReferences`, since it runs only once scripts load.
 */
export function validateScriptReferences(
  graph: ContentGraph,
  registered: Set<string>,
): ContentValidationResult {
  const warnings: string[] = [];

  const report = (where: string, scriptId: string | undefined): void => {
    if (!scriptId || registered.has(scriptId)) return;
    warnings.push(`${where} references unknown script behavior "${scriptId}".`);
  };

  for (const npc of graph.npcs ?? []) {
    report(`NPC ${label(npc.id, npc.name)}`, npc.scriptId);
  }
  for (const item of graph.items ?? []) {
    report(`Item ${label(String(item.id), item.name)}`, item.scriptId);
  }
  for (const map of graph.maps ?? []) {
    for (const [row, tiles] of (map.tiles ?? []).entries()) {
      for (const [col, tile] of tiles.entries()) {
        for (const trigger of tile?.triggers ?? []) {
          if (trigger.action !== 'script') continue;
          report(
            `Map ${label(map.id, map.name)} tile (${col}, ${row})`,
            trigger.scriptId,
          );
        }
      }
    }
  }

  return { errors: [], warnings };
}

/**
 * Cross-checks item references, for the collections present in the graph,
 * so a caller can pass one edited document plus the item list. Pure over
 * its input, with no DB access.
 */
export function validateContentReferences(
  graph: ContentGraph,
): ContentValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  checkDuplicateIds('item', graph.items, errors);
  checkDuplicateIds('npc', graph.npcs, errors);
  checkDuplicateIds('shop', graph.shops, errors);
  checkDuplicateIds('map', graph.maps, errors);

  // Without the item list there is nothing to resolve references against, and
  // reporting every reference as dangling would be worse than staying quiet.
  if (!graph.items) return { errors, warnings };
  const itemIds = new Set(graph.items.map((i) => i.id));

  for (const npc of graph.npcs ?? []) {
    for (const drop of npc.itemsToDrop ?? []) {
      if (!itemIds.has(drop.itemId)) {
        warnings.push(
          `NPC ${label(npc.id, npc.name)} drops unknown item ${drop.itemId}.`,
        );
      }
    }
  }

  for (const shop of graph.shops ?? []) {
    for (const product of shop.products ?? []) {
      if (!itemIds.has(product.itemId)) {
        warnings.push(
          `Shop ${label(shop.id, shop.name)} sells unknown item ${product.itemId}.`,
        );
      }
    }
  }

  for (const map of graph.maps ?? []) {
    for (const dropped of map.droppedItems ?? []) {
      if (!itemIds.has(dropped.itemId)) {
        warnings.push(
          `Map ${label(map.id, map.name)} has a dropped unknown item ${dropped.itemId} on the ground.`,
        );
      }
    }
  }

  return { errors, warnings };
}
