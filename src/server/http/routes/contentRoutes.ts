import { Router } from 'express';
import { Access } from '../../../shared/types.js';
import { logger } from '../../logger.js';
import {
  SPRITE_HEIGHT,
  SPRITE_WIDTH,
  TILE_SIZE,
} from '../../../shared/constants.js';
import { parseBody } from '../bodySchemas.js';
import { NpcSchema } from '../../services/content/npcService.js';
import { ItemSchema } from '../../services/content/itemService.js';
import { LootTableSchema } from '../../services/content/lootTableService.js';
import { DialogSchema } from '../../services/content/dialogService.js';
import { QuestSchema } from '../../services/content/questService.js';
import { RecipeSchema } from '../../services/content/recipeService.js';
import { ArrowSchema } from '../../services/content/arrowService.js';
import checkAccess from '../middleware/checkAccess.js';
import { listMaps } from '../../services/world/mapService.js';
import {
  validateContentReferences,
  validateScriptReferences,
  type ContentGraph,
} from '../../services/content/contentValidation.js';
import { isProvided, providedNames } from '../../engine/modules/registry.js';
import {
  describeBehaviors,
  registeredBehaviors,
} from '../../engine/scripting/entityScripts.js';
import {
  createOrUpdateItem,
  deleteItem,
  listItems,
} from '../../services/content/itemService.js';
import {
  cachedLootTables,
  createOrUpdateLootTable,
  deleteLootTable,
  listLootTables,
} from '../../services/content/lootTableService.js';
import {
  cachedDialogs,
  createOrUpdateDialog,
  deleteDialog,
  listDialogs,
} from '../../services/content/dialogService.js';
import {
  cachedQuests,
  createOrUpdateQuest,
  deleteQuest,
  listQuests,
} from '../../services/content/questService.js';
import {
  createOrUpdateRecipe,
  deleteRecipe,
  listRecipes,
} from '../../services/content/recipeService.js';
import {
  createOrUpdateNpc,
  listNpcs,
  updateNpcAll,
  deleteNpc,
} from '../../services/content/npcService.js';
import {
  listSpells,
  createOrUpdateSpell,
  SpellSchema,
  deleteSpell,
} from '../../services/content/spellService.js';
import {
  listArrows,
  createOrUpdateArrow,
  deleteArrow,
} from '../../services/content/arrowService.js';

/**
 * The catalog the content editor edits: what an npc, an item, a spell or an
 * arrow is, and the four authored documents (loot, dialog, quest, recipe)
 * that name them. The map grid is in mapRoutes and shops in shopRoutes.
 * Every write here regenerates the script constants, through the
 * `contentRefresh` middleware the app mounts.
 */

/**
 * The loot table, dialog and quest ids that exist, for resolving what an npc
 * points at. Ids only, from the boot caches: with full documents, saving one
 * npc would also warn about some unrelated broken conversation.
 */
function existingReferences() {
  return {
    lootTables: cachedLootTables().map((table) => ({ id: table.id })),
    dialogs: cachedDialogs().map((dialog) => ({ id: dialog.id })),
    quests: cachedQuests().map((quest) => ({ id: quest.id })),
  };
}

/**
 * Warnings for conditions, actions and rewards naming something no script
 * registered: only the provide() half of `validateScriptReferences`. Safe
 * here, unlike at boot, since scripts have loaded before an editor can POST.
 */
function namedScriptWarnings(graph: ContentGraph): string[] {
  return validateScriptReferences(graph, new Map(), isProvided).warnings;
}

export function createContentRouter() {
  const router = Router();

  router.get('/npcs', checkAccess(Access.ADMIN), async (_req, res) => {
    try {
      const npcs = await listNpcs();
      res.status(200).json(npcs);
    } catch (_error) {
      res.status(500).json({ error: 'Could not fetch NPCs' });
    }
  });

  router.post('/npcs', checkAccess(Access.ADMIN), async (req, res) => {
    const body = parseBody(NpcSchema, req.body, res);
    if (!body) return;

    const npcData = {
      width: SPRITE_WIDTH,
      height: SPRITE_HEIGHT,
      attackRange: TILE_SIZE,
      ...body,
    };

    // Same contract as /saveMap: a dangling drop id is a warning, not a
    // rejection, so the editor can surface it without blocking the save.
    const { warnings } = validateContentReferences({
      items: await listItems(),
      npcs: [npcData],
      ...existingReferences(),
    });
    warnings.push(
      ...validateScriptReferences({ npcs: [npcData] }, registeredBehaviors())
        .warnings,
    );

    await createOrUpdateNpc(npcData);
    res.status(201).json({ ...npcData, warnings });
  });

  router.put('/npcs/:id', checkAccess(Access.ADMIN), async (req, res) => {
    const body = parseBody(NpcSchema, req.body, res);
    if (!body) return;
    const id = req.params['id'];
    // Editing an existing npc is the common path, so the create route's checks
    // run here too, or a renamed behaviour param would be reported only for
    // npcs created after the rename.
    const { warnings } = validateScriptReferences(
      { npcs: [{ ...body, id }] },
      registeredBehaviors(),
    );
    warnings.push(
      ...validateContentReferences({
        npcs: [{ ...body, id }],
        ...existingReferences(),
      }).warnings,
    );
    const updated = await updateNpcAll(id, body);
    if (!updated) {
      return res.status(404).json({ error: 'NPC not found.' });
    }
    res.status(200).json({ ...updated, warnings });
  });

  router.delete('/npcs/:id', checkAccess(Access.ADMIN), async (req, res) => {
    const id = req.params['id'];
    await deleteNpc(id);
    res.status(204).send();
  });

  router.get('/items', checkAccess(Access.ADMIN), async (_req, res) => {
    try {
      const items = await listItems();
      res.status(200).json(items);
    } catch (_error) {
      res.status(500).json({ error: 'Could not fetch items' });
    }
  });

  router.post('/items', checkAccess(Access.ADMIN), async (req, res) => {
    const body = parseBody(ItemSchema, req.body, res);
    if (!body) return;
    try {
      const { warnings } = validateScriptReferences(
        { items: [{ ...body, id: 0 }] },
        registeredBehaviors(),
      );
      await createOrUpdateItem(body);
      res.status(201).json({ ...body, warnings });
    } catch (_err) {
      res.status(500).json({ error: 'Failed to create item.' });
    }
  });

  router.put('/items/:id', checkAccess(Access.ADMIN), async (req, res) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid item id.' });
    }
    const body = parseBody(ItemSchema, req.body, res);
    if (!body) return;
    try {
      const { warnings } = validateScriptReferences(
        { items: [{ ...body, id }] },
        registeredBehaviors(),
      );
      await createOrUpdateItem({ ...body, id });
      res.status(200).json({ success: true, warnings });
    } catch (_err) {
      res.status(500).json({ error: 'Failed to update item.' });
    }
  });

  router.delete('/items/:id', checkAccess(Access.ADMIN), async (req, res) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid item id.' });
    }
    try {
      await deleteItem(id);
      res.status(204).send();
    } catch (_err) {
      res.status(500).json({ error: 'Failed to delete item.' });
    }
  });

  router.get('/loot', checkAccess(Access.ADMIN), async (_req, res) => {
    res.status(200).json(await listLootTables());
  });

  router.post('/loot', checkAccess(Access.ADMIN), async (req, res) => {
    const body = parseBody(LootTableSchema, req.body, res);
    if (!body) return;
    try {
      // Same contract as the other content editors: a dangling item id is a
      // warning the editor surfaces, not a rejected save.
      const { warnings } = validateContentReferences({
        items: await listItems(),
        lootTables: [body],
      });
      warnings.push(...namedScriptWarnings({ lootTables: [body] }));
      await createOrUpdateLootTable(body);
      res.status(201).json({ ...body, warnings });
    } catch (err) {
      logger.error('createLootTable failed', { err });
      res.status(500).json({ error: 'Failed to save loot table.' });
    }
  });

  router.delete('/loot/:id', checkAccess(Access.ADMIN), async (req, res) => {
    try {
      await deleteLootTable(req.params.id ?? '');
      res.status(204).send();
    } catch (err) {
      logger.error('deleteLootTable failed', { err });
      res.status(500).json({ error: 'Failed to delete loot table.' });
    }
  });

  router.get('/dialogs', checkAccess(Access.ADMIN), async (_req, res) => {
    res.status(200).json(await listDialogs());
  });

  // The names a choice's condition and action can reference right now. A
  // disabled module never provides its handlers, so this is also what keeps
  // its actions out of the editor.
  router.get('/dialogs/refs', checkAccess(Access.ADMIN), (_req, res) => {
    res.json({
      conditions: providedNames('dialogCondition.'),
      actions: providedNames('dialogAction.'),
    });
  });

  router.post('/dialogs', checkAccess(Access.ADMIN), async (req, res) => {
    const body = parseBody(DialogSchema, req.body, res);
    if (!body) return;
    try {
      // A choice pointing at a missing node is a warning, not a rejected save,
      // as conversations are authored half-written.
      const { warnings } = validateContentReferences({
        dialogs: [body],
        quests: cachedQuests().map((quest) => ({ id: quest.id })),
      });
      warnings.push(...namedScriptWarnings({ dialogs: [body] }));
      await createOrUpdateDialog(body);
      res.status(201).json({ ...body, warnings });
    } catch (err) {
      logger.error('createDialog failed', { err });
      res.status(500).json({ error: 'Failed to save dialog.' });
    }
  });

  router.delete('/dialogs/:id', checkAccess(Access.ADMIN), async (req, res) => {
    try {
      await deleteDialog(req.params.id ?? '');
      res.status(204).send();
    } catch (err) {
      logger.error('deleteDialog failed', { err });
      res.status(500).json({ error: 'Failed to delete dialog.' });
    }
  });

  router.get('/quests', checkAccess(Access.ADMIN), async (_req, res) => {
    res.status(200).json(await listQuests());
  });

  router.post('/quests', checkAccess(Access.ADMIN), async (req, res) => {
    const body = parseBody(QuestSchema, req.body, res);
    if (!body) return;
    try {
      // The objective names npcs, items and maps, resolved as ids only, like
      // the npc save; full documents would make a quest save report an
      // unrelated npc dropping a deleted item.
      const [items, npcs, maps] = await Promise.all([
        listItems(),
        listNpcs(),
        listMaps(),
      ]);
      const { warnings } = validateContentReferences({
        quests: [body],
        items: items.map((item) => ({ id: item.id })),
        npcs: npcs.map((npc) => ({ id: npc.id })),
        maps: maps.map((map) => ({ id: map.id })),
      });
      warnings.push(...namedScriptWarnings({ quests: [body] }));
      await createOrUpdateQuest(body);
      res.status(201).json({ ...body, warnings });
    } catch (err) {
      logger.error('createQuest failed', { err });
      res.status(500).json({ error: 'Failed to save quest.' });
    }
  });

  router.delete('/quests/:id', checkAccess(Access.ADMIN), async (req, res) => {
    try {
      await deleteQuest(req.params.id ?? '');
      res.status(204).send();
    } catch (err) {
      logger.error('deleteQuest failed', { err });
      res.status(500).json({ error: 'Failed to delete quest.' });
    }
  });

  router.get('/recipes', checkAccess(Access.ADMIN), async (_req, res) => {
    res.status(200).json(await listRecipes());
  });

  router.post('/recipes', checkAccess(Access.ADMIN), async (req, res) => {
    const body = parseBody(RecipeSchema, req.body, res);
    if (!body) return;
    try {
      // Items only: a recipe names nothing else, and the item list is what
      // decides whether it can ever be crafted.
      const items = await listItems();
      const { warnings } = validateContentReferences({
        recipes: [body],
        items: items.map((item) => ({ id: item.id })),
      });
      warnings.push(...namedScriptWarnings({ recipes: [body] }));
      await createOrUpdateRecipe(body);
      res.status(201).json({ ...body, warnings });
    } catch (err) {
      logger.error('createRecipe failed', { err });
      res.status(500).json({ error: 'Failed to save recipe.' });
    }
  });

  router.delete('/recipes/:id', checkAccess(Access.ADMIN), async (req, res) => {
    try {
      await deleteRecipe(req.params.id ?? '');
      res.status(204).send();
    } catch (err) {
      logger.error('deleteRecipe failed', { err });
      res.status(500).json({ error: 'Failed to delete recipe.' });
    }
  });

  router.get('/spells', checkAccess(Access.ADMIN), async (_req, res) => {
    try {
      res.json(await listSpells());
    } catch {
      res.status(500).json({ error: 'Could not fetch spells' });
    }
  });

  router.post('/spells', checkAccess(Access.ADMIN), async (req, res) => {
    const body = parseBody(SpellSchema, req.body, res);
    if (!body) return;
    try {
      const spell = await createOrUpdateSpell(body);
      res.status(201).json(spell);
    } catch {
      res.status(500).json({ error: 'Failed to create spell.' });
    }
  });

  router.put('/spells/:id', checkAccess(Access.ADMIN), async (req, res) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id.' });
    const body = parseBody(SpellSchema, req.body, res);
    if (!body) return;
    try {
      await createOrUpdateSpell({ ...body, id });
      res.status(200).json({ success: true });
    } catch {
      res.status(500).json({ error: 'Failed to update spell.' });
    }
  });

  router.delete('/spells/:id', checkAccess(Access.ADMIN), async (req, res) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id.' });
    try {
      await deleteSpell(id);
      res.status(204).send();
    } catch {
      res.status(500).json({ error: 'Failed to delete spell.' });
    }
  });

  router.get('/arrows', checkAccess(Access.ADMIN), async (_req, res) => {
    try {
      res.json(await listArrows());
    } catch {
      res.status(500).json({ error: 'Could not fetch arrows' });
    }
  });

  router.post('/arrows', checkAccess(Access.ADMIN), async (req, res) => {
    const body = parseBody(ArrowSchema, req.body, res);
    if (!body) return;
    try {
      const arrow = await createOrUpdateArrow(body);
      res.status(201).json(arrow);
    } catch {
      res.status(500).json({ error: 'Failed to create arrow.' });
    }
  });

  router.put('/arrows/:id', checkAccess(Access.ADMIN), async (req, res) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id.' });
    const body = parseBody(ArrowSchema, req.body, res);
    if (!body) return;
    try {
      await createOrUpdateArrow({ ...body, id });
      res.status(200).json({ success: true });
    } catch {
      res.status(500).json({ error: 'Failed to update arrow.' });
    }
  });

  router.delete('/arrows/:id', checkAccess(Access.ADMIN), async (req, res) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id.' });
    try {
      await deleteArrow(id);
      res.status(204).send();
    } catch {
      res.status(500).json({ error: 'Failed to delete arrow.' });
    }
  });

  // Behaviours currently registered by scripts, with the params each declares,
  // so the content editors can offer them by name and render a field per param
  // instead of asking a designer to remember both. Lives here rather than in
  // scriptsRoutes because that router is only mounted when the script editor is
  // enabled, while behaviours exist whenever scripts do.
  router.get('/behaviors', checkAccess(Access.ADMIN), (_req, res) => {
    res.json(describeBehaviors());
  });

  return router;
}
