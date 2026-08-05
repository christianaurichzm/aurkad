// Referential integrity across content collections. Each collection
// validates its own shape, but a shop selling an item that does not exist
// saves fine and fails only when a player opens it. mapValidation.ts does
// this for map tiles; this covers references outside tiles. As there, a
// dangling reference is a WARNING (it loads and the creator is told), and a
// problem that makes data silently unrecoverable is an ERROR.

import {
  checkStoredParams,
  itemBehaviorEvents,
  type ScriptBehaviorEvent,
  type ScriptParamSpec,
} from '../../../shared/scriptParams.js';
import { TILE_SIZE } from '../../../shared/constants.js';

export interface ContentValidationResult {
  errors: string[];
  warnings: string[];
}

interface ItemRef {
  id: number;
  name?: string;
  /** Which behaviour events the item can reach (see itemBehaviorEvents). */
  type?: string | undefined;
  scriptId?: string | undefined;
  scriptParams?: Record<string, unknown> | undefined;
}
// id is optional because the editor validates a document before it is saved,
// and ids for new documents are assigned on persist.
interface NpcRef {
  id?: string;
  name?: string;
  itemsToDrop?: Array<{ itemId: number }> | undefined;
  lootTableId?: string | undefined;
  dialogId?: string | undefined;
  questId?: string | undefined;
  scriptId?: string | undefined;
  scriptParams?: Record<string, unknown> | undefined;
}
interface DialogRef {
  id?: string;
  name?: string;
  start?: string | undefined;
  nodes?: Array<{
    id: string;
    choices?:
      | Array<{ next?: string | undefined; action?: string | undefined }>
      | undefined;
  }>;
}
interface QuestRef {
  id?: string;
  name?: string;
  objective?:
    | {
        type?: string;
        npcId?: string | undefined;
        itemId?: number | undefined;
        count?: number | undefined;
        mapId?: string | undefined;
        row?: number | undefined;
        col?: number | undefined;
      }
    | undefined;
  reward?:
    | { items?: Array<{ itemId: number }> | undefined; script?: string }
    | undefined;
}
interface LootTableRef {
  id?: string;
  name?: string;
  guaranteed?: Array<{ itemId: number }> | undefined;
  entries?: Array<{ itemId: number }> | undefined;
}
interface ShopRef {
  id?: string;
  name?: string;
  products?: Array<{ itemId: number }> | undefined;
}
interface TileRef {
  blocked?: boolean;
  warp?: { to: string; position: { x: number; y: number } } | undefined;
  npcSpawn?: string | undefined;
  triggers?:
    | Array<{
        action: string;
        scriptId?: string;
        scriptParams?: Record<string, unknown> | undefined;
      }>
    | undefined;
}
interface MapRef {
  id?: string;
  name?: string;
  droppedItems?: Array<{ itemId: number }> | undefined;
  tiles?: TileRef[][] | undefined;
  borderLinks?:
    | Partial<
        Record<
          'up' | 'down' | 'left' | 'right',
          { to: string; position: { x: number; y: number } }
        >
      >
    | undefined;
}

/** Where players enter the world, so reachability has a root to start from. */
export interface WorldStart {
  startMapId: string;
  respawnTile: { col: number; row: number };
}

export interface ContentGraph {
  items?: ItemRef[];
  npcs?: NpcRef[];
  shops?: ShopRef[];
  maps?: MapRef[];
  lootTables?: LootTableRef[];
  dialogs?: DialogRef[];
  quests?: QuestRef[];
}

function label(id: string | undefined, name?: string): string {
  if (!id) return name ? `"${name}"` : '(unsaved)';
  return name && name !== id ? `"${id}" (${name})` : `"${id}"`;
}

/**
 * The quest id in a dialog action `questStart:<id>`, or undefined for any
 * other. The split is the dialog module's and the name the quest module's,
 * both sandbox code that cannot import from here, so this reads the same
 * convention a second time; a typo is a quest offer that does nothing.
 */
function questStartTarget(action: string | undefined): string | undefined {
  if (!action?.startsWith('questStart:')) return undefined;
  return action.slice('questStart:'.length) || undefined;
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
 * Reports content naming a behaviour no script registered, values that do
 * not fit its declared params, and a behaviour with no event this content
 * reaches (an item naming an npc's behaviour, equipment a consumable's).
 * All three save clean and do nothing at runtime; a renamed param leaves
 * content on the old key, and changing an item's type changes its events.
 * Separate from `validateContentReferences`, as it runs once scripts load,
 * after content import.
 */
export function validateScriptReferences(
  graph: ContentGraph,
  registered: ReadonlyMap<
    string,
    { params: ScriptParamSpec[]; events: ScriptBehaviorEvent[] }
  >,
): ContentValidationResult {
  const warnings: string[] = [];

  const report = (
    where: string,
    reachable: ScriptBehaviorEvent[],
    scriptId: string | undefined,
    scriptParams?: Record<string, unknown> | undefined,
  ): void => {
    if (!scriptId) return;
    const behavior = registered.get(scriptId);
    if (!behavior) {
      warnings.push(
        `${where} references unknown script behavior "${scriptId}".`,
      );
      return;
    }
    if (reachable.length === 0) {
      warnings.push(
        `${where} names behavior "${scriptId}", but no behavior event ever reaches this content, so nothing runs.`,
      );
    } else if (!behavior.events.some((event) => reachable.includes(event))) {
      warnings.push(
        `${where} names behavior "${scriptId}", which has no ${reachable.join(' or ')} handler, so nothing runs.`,
      );
    }
    for (const problem of checkStoredParams(behavior.params, scriptParams)) {
      warnings.push(`${where} behavior "${scriptId}": ${problem}.`);
    }
  };

  for (const npc of graph.npcs ?? []) {
    report(
      `NPC ${label(npc.id, npc.name)}`,
      ['onInteract', 'onDeath'],
      npc.scriptId,
      npc.scriptParams,
    );
  }
  for (const item of graph.items ?? []) {
    report(
      `Item ${label(String(item.id), item.name)}`,
      itemBehaviorEvents(item.type),
      item.scriptId,
      item.scriptParams,
    );
  }
  for (const map of graph.maps ?? []) {
    for (const [row, tiles] of (map.tiles ?? []).entries()) {
      for (const [col, tile] of tiles.entries()) {
        for (const trigger of tile?.triggers ?? []) {
          if (trigger.action !== 'script') continue;
          report(
            `Map ${label(map.id, map.name)} tile (${col}, ${row})`,
            ['onEnter'],
            trigger.scriptId,
            trigger.scriptParams,
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
  checkDuplicateIds('loot table', graph.lootTables, errors);
  checkDuplicateIds('dialog', graph.dialogs, errors);
  checkDuplicateIds('quest', graph.quests, errors);

  // An npc pointing at a table that does not exist rolls its legacy
  // itemsToDrop instead, so the loot silently changes rather than failing.
  if (graph.lootTables) {
    const tableIds = new Set(graph.lootTables.map((t) => t.id));
    for (const npc of graph.npcs ?? []) {
      if (npc.lootTableId && !tableIds.has(npc.lootTableId)) {
        warnings.push(
          `NPC ${label(npc.id, npc.name)} uses unknown loot table "${npc.lootTableId}".`,
        );
      }
    }
  }

  if (graph.dialogs) {
    const dialogIds = new Set(graph.dialogs.map((d) => d.id));
    for (const npc of graph.npcs ?? []) {
      if (npc.dialogId && !dialogIds.has(npc.dialogId)) {
        warnings.push(
          `NPC ${label(npc.id, npc.name)} opens unknown dialog "${npc.dialogId}".`,
        );
      }
    }
  }

  if (graph.quests) {
    const questIds = new Set(graph.quests.map((q) => q.id));
    for (const npc of graph.npcs ?? []) {
      if (npc.questId && !questIds.has(npc.questId)) {
        warnings.push(
          `NPC ${label(npc.id, npc.name)} offers unknown quest "${npc.questId}".`,
        );
      }
    }
    // The other door into a quest is a dialog choice, so it is checked here
    // too: `questStart:<id>` naming nothing is a button that looks like an
    // offer and does nothing when pressed.
    for (const dialog of graph.dialogs ?? []) {
      for (const node of dialog.nodes ?? []) {
        for (const choice of node.choices ?? []) {
          const id = questStartTarget(choice.action);
          if (id && !questIds.has(id)) {
            warnings.push(
              `Dialog ${label(dialog.id, dialog.name)} node "${node.id}" starts unknown quest "${id}".`,
            );
          }
        }
      }
    }
  }

  // An objective nothing can satisfy is the failure mode here: the quest is
  // offered, accepted, and then sits in the tracker forever because the npc it
  // counts does not exist.
  if (graph.npcs) {
    const npcIds = new Set(graph.npcs.map((n) => n.id));
    for (const quest of graph.quests ?? []) {
      const objective = quest.objective;
      if (
        (objective?.type === 'kill' || objective?.type === 'talk') &&
        objective.npcId &&
        !npcIds.has(objective.npcId)
      ) {
        warnings.push(
          `Quest ${label(quest.id, quest.name)} counts unknown NPC "${objective.npcId}", so it can never be completed.`,
        );
      }
    }
  }

  if (graph.maps) {
    const mapIds = new Set(graph.maps.map((m) => m.id));
    for (const quest of graph.quests ?? []) {
      const objective = quest.objective;
      if (
        objective?.type === 'reach' &&
        objective.mapId &&
        !mapIds.has(objective.mapId)
      ) {
        warnings.push(
          `Quest ${label(quest.id, quest.name)} sends the player to unknown map "${objective.mapId}", so it can never be completed.`,
        );
      }
    }
  }

  // A conversation is a graph, so it gets the same treatment the world graph
  // gets: nodes that nothing points at are branches a player can never see, and
  // a choice leading nowhere is the dangling reference of this collection.
  for (const dialog of graph.dialogs ?? []) {
    const where = `Dialog ${label(dialog.id, dialog.name)}`;
    const nodes = dialog.nodes ?? [];
    const nodeIds = new Set<string>();
    for (const node of nodes) {
      if (nodeIds.has(node.id)) {
        // Two nodes under one id collapse on lookup: whichever the walk finds
        // first wins, and the other text simply never appears.
        errors.push(
          `${where} has duplicate node id "${node.id}": only one of them can ever be reached.`,
        );
      }
      nodeIds.add(node.id);
    }

    const start = dialog.start ?? nodes[0]?.id;
    if (dialog.start && !nodeIds.has(dialog.start)) {
      warnings.push(
        `${where} starts at unknown node "${dialog.start}", so talking never opens it.`,
      );
    }

    for (const node of nodes) {
      for (const choice of node.choices ?? []) {
        if (choice.next && !nodeIds.has(choice.next)) {
          warnings.push(
            `${where} node "${node.id}" leads to unknown node "${choice.next}", so that choice ends the conversation.`,
          );
        }
      }
    }

    if (start && nodeIds.has(start)) {
      const reached = new Set<string>([start]);
      const queue = [start];
      const byId = new Map(nodes.map((node) => [node.id, node]));
      while (queue.length) {
        const current = byId.get(queue.shift()!);
        for (const choice of current?.choices ?? []) {
          if (
            choice.next &&
            nodeIds.has(choice.next) &&
            !reached.has(choice.next)
          ) {
            reached.add(choice.next);
            queue.push(choice.next);
          }
        }
      }
      for (const node of nodes) {
        if (!reached.has(node.id)) {
          warnings.push(
            `${where} node "${node.id}" cannot be reached from the start node, so no player ever sees it.`,
          );
        }
      }
    }
  }

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

  for (const quest of graph.quests ?? []) {
    const where = `Quest ${label(quest.id, quest.name)}`;
    const objective = quest.objective;
    if (
      objective?.type === 'collect' &&
      objective.itemId != null &&
      !itemIds.has(objective.itemId)
    ) {
      warnings.push(
        `${where} asks for unknown item ${objective.itemId}, so it can never be completed.`,
      );
    }
    for (const reward of quest.reward?.items ?? []) {
      if (!itemIds.has(reward.itemId)) {
        warnings.push(`${where} rewards unknown item ${reward.itemId}.`);
      }
    }
  }

  for (const table of graph.lootTables ?? []) {
    const where = `Loot table ${label(table.id, table.name)}`;
    for (const entry of [
      ...(table.guaranteed ?? []),
      ...(table.entries ?? []),
    ]) {
      if (!itemIds.has(entry.itemId)) {
        warnings.push(`${where} drops unknown item ${entry.itemId}.`);
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

/**
 * Whole-world checks: can a player reach the content, and does a warp land
 * somewhere they can stand. It needs every map's tiles, so it runs where the
 * world is in memory, at boot and content import; the editor validates one
 * map at a time with `mapValidation`.
 */
export function validateWorldGraph(
  graph: ContentGraph,
  world?: WorldStart,
): ContentValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const maps = (graph.maps ?? []).filter((map) => map.id && map.tiles);
  if (maps.length === 0) return { errors, warnings };

  const byId = new Map(maps.map((map) => [map.id!, map]));
  const tileAt = (
    map: MapRef,
    position: { x: number; y: number },
  ): TileRef | undefined =>
    map.tiles?.[Math.round(position.y / TILE_SIZE)]?.[
      Math.round(position.x / TILE_SIZE)
    ];

  const exitsOf = (map: MapRef) => {
    const exits: Array<{ to: string; position: { x: number; y: number } }> = [];
    for (const row of map.tiles ?? []) {
      for (const tile of row) if (tile.warp) exits.push(tile.warp);
    }
    for (const link of Object.values(map.borderLinks ?? {})) {
      if (link) exits.push(link);
    }
    return exits;
  };

  // Where a warp puts the player, not whether the graph loops: a two-way
  // door is a loop, as it should be. The bug is landing on another warp,
  // which fires on arrival, and two pointing at each other ping-pong forever.
  for (const map of maps) {
    for (const exit of exitsOf(map)) {
      const target = byId.get(exit.to);
      if (!target) continue; // dangling target: already reported per-map

      const landing = tileAt(target, exit.position);
      if (!landing) continue; // out of bounds: mapValidation reports it

      if (landing.warp) {
        warnings.push(
          `Warp from map ${label(map.id, map.name)} lands on another warp in ${label(target.id, target.name)} at (${exit.position.x},${exit.position.y}): the player is moved again on arrival.`,
        );
      } else if (landing.blocked) {
        warnings.push(
          `Warp from map ${label(map.id, map.name)} lands on a blocked tile in ${label(target.id, target.name)} at (${exit.position.x},${exit.position.y}).`,
        );
      }
    }
  }

  // Reachability from where players enter. With no start there is no root,
  // and calling every map an orphan would be worse than silence.
  if (world && byId.has(world.startMapId)) {
    const reached = new Set<string>([world.startMapId]);
    const queue = [world.startMapId];
    while (queue.length) {
      const current = byId.get(queue.shift()!);
      if (!current) continue;
      for (const exit of exitsOf(current)) {
        if (byId.has(exit.to) && !reached.has(exit.to)) {
          reached.add(exit.to);
          queue.push(exit.to);
        }
      }
    }

    for (const map of maps) {
      if (!reached.has(map.id!)) {
        warnings.push(
          `Map ${label(map.id, map.name)} cannot be reached from the start map "${world.startMapId}" by any warp or border link.`,
        );
      }
    }

    // Everyone enters and respawns here, so a blocked tile is every player
    // stuck in a wall at once: an error rather than a warning.
    const start = byId.get(world.startMapId)!;
    const spawn = start.tiles?.[world.respawnTile.row]?.[world.respawnTile.col];
    if (!spawn) {
      errors.push(
        `Respawn tile (col ${world.respawnTile.col}, row ${world.respawnTile.row}) is outside the start map ${label(start.id, start.name)}.`,
      );
    } else if (spawn.blocked) {
      errors.push(
        `Respawn tile (col ${world.respawnTile.col}, row ${world.respawnTile.row}) on the start map ${label(start.id, start.name)} is blocked: players would spawn inside a wall.`,
      );
    }
  }

  // An npc with no spawn tile never appears, and one whose only tile was
  // deleted dies once and never returns, as respawnNpc picks from the tiles
  // naming it and gives up when there are none.
  if (graph.npcs) {
    const spawned = new Set<string>();
    for (const map of maps) {
      for (const row of map.tiles ?? []) {
        for (const tile of row) if (tile.npcSpawn) spawned.add(tile.npcSpawn);
      }
    }
    for (const npc of graph.npcs) {
      if (npc.id && !spawned.has(String(npc.id))) {
        warnings.push(
          `NPC ${label(npc.id, npc.name)} has no spawn tile on any map, so it never appears.`,
        );
      }
    }
  }

  return { errors, warnings };
}
