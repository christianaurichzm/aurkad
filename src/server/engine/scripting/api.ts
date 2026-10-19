import { on as hookOn } from '../hooks.js';
import { emitGameEvent } from '../eventBus.js';
import {
  getPlayerByName,
  awardExperience,
  persistPlayersNow,
  commitInventories,
} from '../../services/player/playerService.js';
import { runtimeState } from '../../sim/state.js';
import {
  flagEnabled,
  flagNumber,
  getFlag,
  type FlagValue,
} from '../../services/liveOpsService.js';
import { getMap, updatePlayer } from '../../sim/world.js';
import { handleChatAction } from '../../services/comms/chatService.js';
import { setIgnored } from '../../services/serverState.js';
import { setMapTile } from '../../services/world/mapService.js';
import { warpToMap } from '../../services/world/movementService.js';
import {
  checkDataWrite,
  copyStoredValue,
  explainLimit,
} from '../../persistence/dataLimits.js';
import {
  kvGet,
  kvSet,
  kvDelete,
  kvKeys,
  kvEntries,
} from '../../persistence/kvStore.js';
import {
  sendCustomEvent,
  sendMapCustomEvent,
  broadcastCustomEvent,
} from '../../services/comms/customEventService.js';
import { registerCommand } from '../commands.js';
import { registerStrings, translate } from '../i18n.js';
import { provideApi, useApi } from '../modules/registry.js';
import {
  setCosmetic,
  clearCosmetic,
} from '../../services/player/cosmeticsService.js';
import { spawnNpc, despawnNpc } from '../../services/npc/spawn.js';
import { stepNpcToward } from '../../services/npc/behaviors.js';
import { getItemById, items } from '../../services/content/itemService.js';
import {
  addItem,
  canFit,
  countItem,
  exchangeItems,
  hasItem,
  moveItem,
  removeItem,
  type EconomyResult,
  type ItemAmount,
} from '../../services/economy/economyService.js';
import {
  cancelDelivery,
  claimDeliveries,
  countDeliveries,
  listDeliveries,
  queueDelivery,
  sendDelivery,
  type ClaimOutcome,
  type DeliveryFee,
  type PendingDelivery,
  type QueueResult,
} from '../../services/economy/deliveryService.js';
import {
  getArrowSync,
  getAllArrows,
} from '../../services/content/arrowService.js';
import {
  getAllSpells,
  createOrUpdateSpell,
} from '../../services/content/spellService.js';
import { getDialogById } from '../../services/content/dialogService.js';
import {
  cachedQuests,
  getQuestById,
} from '../../services/content/questService.js';
import { cachedRecipes } from '../../services/content/recipeService.js';
import { queryEntitiesInRadius } from '../../sim/spatialManager.js';
import type { SpawnNpcOptions } from '../../services/npc/spawn.js';
import {
  killPlayer as killPlayerNow,
  resolveDamage,
} from '../../services/combat/index.js';
import { mapPvpMorale } from '../../../shared/utils.js';
import { hasCollision } from '../../services/world/physicsService.js';
import type {
  CombatTarget,
  Dialog,
  Item,
  Quest,
  Recipe,
  RuntimeNpc,
} from '../../../shared/types.js';
import { Access } from '../../../shared/types.js';
import type { CommandContext, CommandOptions } from '../commands.js';
import { TILE_SIZE } from '../../../shared/constants.js';
import { config } from '../../config.js';
import { msToTicks } from '../../sim/clock.js';
import {
  scheduleAfter,
  scheduleEvery,
  cancelScheduled,
} from '../../sim/scheduler.js';
import {
  nextRandom,
  randomInt,
  randomChance,
  randomPick,
} from '../../sim/rng.js';
import { logger } from '../../logger.js';
import { recordScriptError, type ScriptErrorSource } from './scriptErrors.js';
import { runWithBudget } from './handlerBudget.js';
import {
  httpRequest,
  type HttpRequestOptions,
  type HttpResponse,
} from './httpOut.js';
import {
  startCoroutine,
  wait,
  waitFor,
  type CoroutineHandle,
} from './coroutines.js';
import {
  registerEntityBehavior,
  type EntityBehavior,
} from './entityScripts.js';
import type { HookMap } from '../hooks.js';
import type { InventoryLike, PlayerServer } from '../../../shared/types.js';
import { recordHealthChange } from '../../net/viewerState.js';
import {
  createAuction,
  listAuctions,
  buyAuction,
  returnAuction,
  sweepAuctions,
} from '../../services/economy/auctionService.js';

// Mutations go through updatePlayer so state is marked dirty (persisted by the
// snapshot loop) and broadcast to clients on the next tick. No DB write happens
// here, which is why scripts can call it from inside a synchronous hook.
type ItemData = Pick<
  Item,
  'id' | 'name' | 'description' | 'sprite' | 'type' | 'arrowId' | 'bound'
> & { effects: NonNullable<Item['effects']> };

// Copied, effects included: a script that edits what it was handed must not
// be editing the catalogue.
const itemData = (item: Item): ItemData => ({
  id: item.id,
  name: item.name,
  description: item.description,
  sprite: item.sprite,
  type: item.type,
  effects: (item.effects ?? []).map((effect) => ({ ...effect })),
  ...(item.arrowId != null && { arrowId: item.arrowId }),
  ...(item.bound != null && { bound: item.bound }),
});

function persist(_scriptName: string, player: PlayerServer): void {
  updatePlayer(player);
}

/**
 * The copy of a script's value that storage keeps, or undefined when it has
 * none. Keeping the script's own object would carry its later changes into
 * storage unmeasured, and in the shared store unflushed. A value holding a
 * function passes the size check (JSON drops it) but cannot be copied.
 */
function storable(value: unknown): { value: unknown } | undefined {
  try {
    return { value: copyStoredValue(value) };
  } catch {
    return undefined;
  }
}

type Cleanup = () => void;
type TimerId = ReturnType<typeof setInterval>;
type AnyHandler = (payload: unknown) => void;

// One line per script per timer kind: enough to find the offender, not enough
// to drown the log if a hot handler keeps calling it.
const wallClockWarned = new Set<string>();
function warnWallClockTimer(
  scriptName: string,
  used: string,
  replacement: string,
): void {
  const key = `${scriptName}:${used}`;
  if (wallClockWarned.has(key)) return;
  wallClockWarned.add(key);
  logger.warn(
    `[script:${scriptName}] ${used} is deprecated: it fires off the tick, so replay ` +
      `cannot reproduce it. Use ${replacement}(ticks, fn) instead (msToTicks(ms) converts).`,
  );
}

export function buildApi(
  scriptName: string,
  trackUnsub: (fn: Cleanup) => void,
  trackTimer: (id: TimerId) => void,
) {
  /**
   * Notes a callback's failure against the script that wrote it, then lets it
   * propagate. The call sites already isolate and log it; this only adds the
   * record the editor shows.
   */
  function attributed(
    fn: () => void,
    source: ScriptErrorSource,
    context: string,
  ): () => void {
    return () => {
      try {
        runWithBudget(scriptName, `${source}:${context}`, () => {
          observeRejection(fn(), source, context);
        });
      } catch (e) {
        recordScriptError(scriptName, e, source, context);
        throw e;
      }
    };
  }

  // VM promises belong to another realm, so instanceof Promise misses them.
  // Observe the value before the synchronous budget wrapper drops it.
  function observeRejection(
    result: unknown,
    source: ScriptErrorSource,
    context: string,
  ): void {
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      void Promise.resolve(result).catch((err) => {
        logger.error(`[script:${scriptName}] async handler rejected`, {
          source,
          context,
          err,
        });
        recordScriptError(scriptName, err, source, context);
      });
    }
  }

  function safeOn(event: keyof HookMap, handler: AnyHandler): Cleanup {
    const wrapped = (payload: unknown) => {
      try {
        // Timed and, if it keeps overrunning, dropped: one slow handler on a
        // hot hook like `tick` costs the whole server its frame.
        runWithBudget(scriptName, `on:${event}`, () => {
          observeRejection(handler(payload), 'hook', event);
        });
      } catch (e) {
        logger.error(`[script:${scriptName}] hook handler threw`, {
          event,
          err: e,
        });
        recordScriptError(scriptName, e, 'hook', event);
      }
    };
    const unsub = hookOn(event, wrapped);
    trackUnsub(unsub);
    return unsub;
  }

  // What the script scheduled or started and is still pending, cancelled with
  // it. A task leaves when it fires and a coroutine when it ends, so a script
  // that starts one per event and never reloads holds only the pending ones.
  // Coroutines go first, because their finally blocks may schedule.
  const liveTasks = new Set<number>();
  const liveCoroutines = new Set<CoroutineHandle>();
  trackUnsub(() => {
    for (const handle of [...liveCoroutines]) handle.cancel();
    for (const id of liveTasks) cancelScheduled(id);
    liveTasks.clear();
  });

  return {
    // Hooks
    on: safeOn,

    // Named behaviour that content attaches by id. `on` listens to everything;
    // this runs only for the tiles, npcs and items whose scriptId names it, so
    // the wiring lives in the editor. A `params` declaration makes one
    // behaviour many: the editor shows a field per param on the content, and
    // the values arrive as `ctx.params`. A malformed declaration throws
    // (registerEntityBehavior says why).
    attach: (scriptId: string, behavior: EntityBehavior): (() => void) => {
      const detach = registerEntityBehavior(
        String(scriptId),
        behavior,
        scriptName,
      );
      trackUnsub(detach);
      return detach;
    },

    // World queries
    getPlayer: (name: string): PlayerServer | undefined =>
      getPlayerByName(name) ?? undefined,
    getPlayers: (): PlayerServer[] =>
      Object.values(runtimeState.maps).flatMap((m) => Object.values(m.players)),

    // A map's PvP morale: 'safe' | 'normal' | 'no-penalty' (e.g. a PK module
    // checks this on playerDeath to decide whether to penalize the killer).
    getMapPvp: (mapId: string): 'safe' | 'normal' | 'no-penalty' => {
      const map = runtimeState.maps[String(mapId)];
      return map ? mapPvpMorale(map) : 'safe';
    },

    // Living NPCs within `radius` px of a point (AoE spells, pet targeting).
    getNearbyNpcs: (
      mapId: string,
      x: number,
      y: number,
      radius: number,
    ): RuntimeNpc[] => {
      const map = runtimeState.maps[String(mapId)];
      if (!map) return [];
      return queryEntitiesInRadius(String(mapId), x, y, radius)
        .map((e) => (e.id ? map.npcs[e.id] : undefined))
        .filter((n): n is RuntimeNpc => !!n && n.health > 0);
    },

    // Spawn/despawn runtime NPCs (pets, summons, bosses). Returns the NPC so
    // you can drive it from on('tick') (e.g. move it toward its owner). The
    // reason is logged in services/npc/spawn.ts; this adds which script asked,
    // since a hook handler runs outside the request context.
    spawnNpc: (opts: SpawnNpcOptions): RuntimeNpc | undefined => {
      const npc = spawnNpc({ ...opts, mapId: String(opts.mapId) });
      if (!npc) {
        logger.warn(`[script:${scriptName}] spawnNpc refused`, {
          mapId: opts.mapId,
          col: opts.col,
          row: opts.row,
        });
      }
      return npc;
    },
    despawnNpc: (npc: { id: string }): void => despawnNpc(npc),

    // Move an NPC one tile toward (x, y) the way the engine moves NPCs: sets
    // facing, respects wall collision, animates. Call at the NPC cadence
    // (~every 25 ticks), NOT every tick, or it teleports.
    moveNpcToward: (npc: RuntimeNpc, x: number, y: number): void => {
      const map = npc.mapId ? getMap(npc.mapId) : undefined;
      if (map) stepNpcToward(npc, { position: { x, y } }, map);
    },

    // Tile size in pixels (positions are in pixels; tiles are TILE_SIZE apart).
    TILE_SIZE,

    // Returns { blocked, tileIndex, maskIndex, bank } for the tile at (col, row)
    // in the given map, or null if out of bounds. Useful for modules that need
    // walkability checks (knockback, LOS) or read what the map shows.
    getMapTile: (mapId: string, col: number, row: number) => {
      const tile = getMap(String(mapId))?.tiles[Math.floor(row)]?.[
        Math.floor(col)
      ];
      return tile
        ? {
            blocked: tile.blocked ?? false,
            tileIndex: tile.tileIndex,
            maskIndex: tile.maskIndex,
            bank: tile.bank ?? false,
          }
        : null;
    },

    // Whether `entity` could stand at pixel (x, y) on its own map, as a step
    // is checked: the tiles under its whole box, a gate a script opens for some
    // players, and anyone already standing there.
    canStand: (entity: CombatTarget, x: number, y: number): boolean =>
      !hasCollision({ ...entity, position: { x: Number(x), y: Number(y) } }),

    // Changes what a tile shows and whether it blocks while the server runs,
    // like a door a script opens. Not saved; see setMapTile in mapService.
    setMapTile: (
      mapId: string,
      col: number,
      row: number,
      change: { tileIndex?: number; blocked?: boolean },
    ): boolean => setMapTile(String(mapId), col, row, change ?? {}),

    getMapSize: (mapId: string): { cols: number; rows: number } | undefined => {
      const map = getMap(String(mapId));
      if (!map?.tiles?.length) return undefined;
      return { cols: map.tiles[0]?.length ?? 0, rows: map.tiles.length };
    },

    // Arrow metadata lookup
    getArrow: (
      id: number,
    ):
      | {
          id: number;
          name: string;
          sprite: number;
          damage: number;
          rangeTiles?: number;
          tileSpeed?: number;
        }
      | undefined => {
      const a = getArrowSync(Number(id));
      if (!a) return undefined;
      return {
        id: a.id,
        name: a.name,
        sprite: a.sprite,
        damage: a.damage,
        ...(a.rangeTiles != null && { rangeTiles: a.rangeTiles }),
        ...(a.tileSpeed != null && { tileSpeed: a.tileSpeed }),
      };
    },
    getArrows: (): {
      id: number;
      name: string;
      sprite: number;
      damage: number;
      rangeTiles?: number;
      tileSpeed?: number;
    }[] =>
      getAllArrows().map((a) => ({
        id: a.id,
        name: a.name,
        sprite: a.sprite,
        damage: a.damage,
        ...(a.rangeTiles != null && { rangeTiles: a.rangeTiles }),
        ...(a.tileSpeed != null && { tileSpeed: a.tileSpeed }),
      })),

    // An authored conversation, by id. Read-only and copied: the document is
    // the editor's, and the cache behind it is read inside the tick, so a
    // module walking a dialog must not be able to edit content by accident.
    getDialog: (id: string): Dialog | undefined => {
      const dialog = getDialogById(id);
      return dialog ? structuredClone(dialog) : undefined;
    },

    // An authored quest, by id, copied for the same reason getDialog copies.
    // Read when it is needed rather than kept: the editor saves into the
    // running game, and a copy taken at load would not know the save.
    getQuest: (id: string): Quest | undefined => {
      const quest = getQuestById(id);
      return quest ? structuredClone(quest) : undefined;
    },

    // Every authored quest, copied the same way.
    getQuests: (): Quest[] => structuredClone(cachedQuests()),

    // Every authored recipe, copied for the same reason getQuests copies. The
    // crafting module reads the whole list to answer what a player can make.
    getRecipes: (): Recipe[] => structuredClone(cachedRecipes()),

    // Spell definitions from the database, each with its name, mpCost,
    // damage, cooldownMs and sprite.
    getSpells: (): {
      id: number;
      name: string;
      description: string;
      sprite: number;
      mpCost: number;
      damage: number;
      cooldownMs: number;
      target: 'enemies' | 'self' | 'party' | 'guild';
      heal: number;
      frames: number;
      visualTarget: 'self' | 'targets';
      icon?: number | null;
    }[] => getAllSpells().map((s) => ({ ...s })),

    // Saves spells to the database one by one, without waiting. Use it when
    // getSpells() is empty, to seed built-ins the SpellEditor then shows.
    createSpells: (
      spellList: {
        name: string;
        description?: string;
        sprite: number;
        mpCost: number;
        damage: number;
        cooldownMs: number;
        target?: 'enemies' | 'self' | 'party' | 'guild';
        heal?: number;
        frames?: number;
        visualTarget?: 'self' | 'targets';
        icon?: number;
      }[],
    ): void => {
      const run = async () => {
        for (const spell of spellList) {
          // Per spell, because these arrive as a batch (a module seeding its
          // built-ins sends the whole list): one entry the service refuses
          // must not take the spells after it down with it.
          try {
            await createOrUpdateSpell({
              name: spell.name,
              description: spell.description ?? '',
              sprite: Number(spell.sprite),
              mpCost: Number(spell.mpCost),
              damage: Number(spell.damage),
              cooldownMs: Number(spell.cooldownMs),
              target: spell.target ?? (spell.damage > 0 ? 'enemies' : 'self'),
              heal: Number(spell.heal ?? 0),
              frames: Number(spell.frames ?? 1),
              visualTarget:
                spell.visualTarget ?? (spell.damage > 0 ? 'targets' : 'self'),
              icon: spell.icon ?? null,
            });
          } catch (e) {
            logger.warn(`[script:${scriptName}] createSpells skipped a spell`, {
              name: spell?.name,
              err: e,
            });
          }
        }
      };
      // Nothing awaits this, so a rejection escaping here would be an
      // unhandledRejection, which ends the process.
      void run().catch((e) =>
        logger.error(`[script:${scriptName}] createSpells failed`, { err: e }),
      );
    },

    // The catalogue as a script may read it: what the item is and does, not
    // the behaviour it runs.
    getItem: (id: number): ItemData | undefined => {
      const item = getItemById(Number(id));
      return item ? itemData(item) : undefined;
    },
    getItems: (): ItemData[] => [...items.values()].map(itemData),

    // Inventory. These return whether they happened, so a script can tell a
    // delivered reward from one a full inventory or a short stack refused.
    giveItem: (player: PlayerServer, itemId: number, quantity = 1): boolean => {
      // Handing out an id no item defines puts an unresolvable entry in the
      // inventory, which then throws while building the stats payload and
      // stops that player receiving any stat update at all.
      if (!getItemById(itemId)) {
        logger.warn(`[script:${scriptName}] giveItem: no such item`, {
          itemId,
        });
        return false;
      }
      const result = addItem(player.inventory, itemId, quantity);
      if (result.ok) persist(scriptName, player);
      return result.ok;
    },
    removeItem: (
      player: PlayerServer,
      itemId: number,
      quantity = 1,
    ): boolean => {
      const result = removeItem(player.inventory, itemId, quantity);
      if (result.ok) persist(scriptName, player);
      return result.ok;
    },
    hasItem: (player: PlayerServer, itemId: number, quantity = 1): boolean =>
      hasItem(player.inventory, itemId, quantity),
    countItem: (player: PlayerServer, itemId: number): number =>
      countItem(player.inventory, itemId),
    canCarry: (player: PlayerServer, itemId: number): boolean =>
      canFit(player.inventory, itemId),
    // Atomic transfer between any two containers: an inventory, a bank, a
    // mailbox. Both sides are checked first, so a full destination never
    // consumes the source; a failure returns the reason to show the player.
    moveItem: (
      from: InventoryLike,
      to: InventoryLike,
      itemId: number,
      amount = 1,
    ): EconomyResult => moveItem(from, to, itemId, amount),

    // Consumes several items and produces one, or changes nothing, which
    // removeItem plus giveItem cannot promise: a bag with no room for the
    // result would keep the payment. Repeated ids are summed, and capacity is
    // judged on the inventory the exchange leaves behind.
    exchangeItems: (
      player: PlayerServer,
      inputs: ItemAmount[],
      output: ItemAmount,
    ): EconomyResult => {
      // Producing an id no item defines would put an unresolvable entry in the
      // inventory, the same way giveItem guards against.
      if (!getItemById(Number(output.itemId))) {
        logger.warn(`[script:${scriptName}] exchangeItems: no such item`, {
          itemId: output.itemId,
        });
        return { ok: false, reason: 'invalid-amount' };
      }
      const result = exchangeItems(player.inventory, inputs, output);
      if (result.ok) persist(scriptName, player);
      return result;
    },

    // Economic commit: persist these players now instead of waiting for the
    // snapshot loop, so a crash cannot revert a confirmed transfer.
    persistNow: (...playersToSave: PlayerServer[]): Promise<boolean> =>
      persistPlayersNow(playersToSave.filter((p) => !!p)),

    // A transfer between players that is confirmed only once it is durable:
    // the change runs on copies and reaches the live inventories after the
    // write lands (see commitInventories in playerService).
    commitInventories,

    auctions: {
      list: listAuctions,
      create: createAuction,
      buy: buyAuction,
      cancel: returnAuction,
      sweep: sweepAuctions,
    },

    // Items owed to a player who may be offline, which trade cannot cover.
    // These hit the database and return promises. The queue is core because
    // `claim` adds to the inventory and records the claim in one write, so a
    // crash cannot duplicate or lose it (services/economy/deliveryService.ts).
    delivery: {
      queue: (input: {
        to: string;
        itemId: number;
        quantity?: number;
        meta?: unknown;
      }): Promise<QueueResult> =>
        queueDelivery({ ...input, source: scriptName }),
      // Queues this player's item: the debit and the row are one commit, so
      // the caller neither persists nor refunds. `queue` creates an item from
      // nothing, a different risk, as only a transfer can half-happen.
      send: (
        from: PlayerServer,
        input: {
          to: string;
          itemId: number;
          quantity?: number;
          meta?: unknown;
          fee?: DeliveryFee;
        },
      ): Promise<QueueResult> =>
        sendDelivery(from, { ...input, source: scriptName }),
      list: (name: string): Promise<PendingDelivery[]> =>
        listDeliveries(String(name)),
      count: (name: string): Promise<number> => countDeliveries(String(name)),
      // Recipient must be online: the item lands in their live inventory.
      claim: (player: PlayerServer, ids?: string[]): Promise<ClaimOutcome[]> =>
        claimDeliveries(player, ids),
      cancel: (id: string): Promise<boolean> => cancelDelivery(String(id)),
    },

    // Health
    // Without an amount, to full.
    healPlayer: (player: PlayerServer, amount?: number): void => {
      const before = player.health;
      player.health =
        amount === undefined
          ? player.maxHealth
          : Math.min(player.maxHealth, player.health + Math.max(0, amount));
      recordHealthChange(player, player.health - before);
      persist(scriptName, player);
    },
    killPlayer: (player: PlayerServer): void => {
      if (!killPlayerNow(player)) persist(scriptName, player);
    },
    dealDamage: (
      target: CombatTarget | null | undefined,
      amount: number,
      attacker?: CombatTarget | null,
    ): void => {
      if (!target) return;
      resolveDamage(target, amount, {
        attacker: attacker ?? undefined,
        map: getMap(target.mapId),
      });
    },

    // Grant XP (routes through the beforeXpGain hook, so multipliers apply).
    giveExperience: (player: PlayerServer, amount: number): void => {
      awardExperience(player, amount, 'script');
      persist(scriptName, player);
    },

    // Cosmetic name color drawn above the sprite (overrides the access color).
    // Pass undefined to clear it. Goes through the cosmetic resolver as the
    // low-priority "base" source.
    setNameColor: (player: PlayerServer, color: string | undefined): void => {
      if (color === undefined) clearCosmetic(player, 'nameColor', 'base');
      else setCosmetic(player, 'nameColor', 'base', color, 0);
      persist(scriptName, player);
    },

    // Cosmetic tag drawn above the name (e.g. a guild name), in `color` when
    // given (any CSS colour). undefined clears it.
    setNameTag: (
      player: PlayerServer,
      tag: string | undefined,
      color?: string,
    ): void => {
      if (tag === undefined) clearCosmetic(player, 'nameTag', 'base');
      else setCosmetic(player, 'nameTag', 'base', tag, 0, color);
      persist(scriptName, player);
    },

    // Conflict-safe cosmetics: add a named, prioritized source to a field
    // ('nameColor' | 'nameTag'). Highest priority wins; clear withdraws it.
    setCosmetic: (
      player: PlayerServer,
      field: 'nameColor' | 'nameTag',
      source: string,
      value: string,
      priority?: number,
    ): void => {
      setCosmetic(player, field, String(source), value, priority);
      persist(scriptName, player);
    },
    clearCosmetic: (
      player: PlayerServer,
      field: 'nameColor' | 'nameTag',
      source: string,
    ): void => {
      clearCosmetic(player, field, String(source));
      persist(scriptName, player);
    },

    // Per-player custom data, persisted with the player record. Reads return
    // a copy, or the natural pattern would grow the stored value before the
    // size check could refuse it:
    //
    //     const log = getPlayerData(p, 'log') || [];
    //     log.push(entry);              // mutates what is already stored
    //     setPlayerData(p, 'log', log); // refused, but too late
    getPlayerData: <T = unknown>(
      player: PlayerServer,
      key: string,
    ): T | undefined =>
      copyStoredValue(player.data?.[String(key)]) as T | undefined,
    // Returns whether it was stored. A refusal keeps the player document
    // under MongoDB's limit (persistence/dataLimits.ts), past which it can no
    // longer be saved.
    setPlayerData: (
      player: PlayerServer,
      key: string,
      value: unknown,
    ): boolean => {
      // undefined clears the key (the guild module leaves a guild this way),
      // as JSON drops it anyway. It is also the way out of the key limit.
      if (value === undefined) {
        if (player.data) delete player.data[String(key)];
        persist(scriptName, player);
        return true;
      }

      const check = checkDataWrite(player.data, String(key), value);
      const copy = check.ok ? storable(value) : undefined;
      if (!copy) {
        logger.warn(
          `[script:${scriptName}] setPlayerData("${key}") refused: ${explainLimit(check.ok ? { reason: 'not-serializable' } : check)}`,
        );
        return false;
      }
      (player.data ??= {})[String(key)] = copy.value;
      persist(scriptName, player);
      return true;
    },

    // Scoped key-value store (shared, persisted). Reads/writes are synchronous.
    // Values go in and come out as copies, for the reason player data does.
    store: {
      get: <T = unknown>(scope: string, key: string): T | undefined =>
        copyStoredValue(kvGet(String(scope), String(key))),
      set: (scope: string, key: string, value: unknown): boolean => {
        const copy = storable(value);
        if (!copy) {
          logger.warn(
            `[script:${scriptName}] store.set("${scope}/${key}") refused: ${explainLimit({ reason: 'not-serializable' })}`,
          );
          return false;
        }
        return kvSet(String(scope), String(key), copy.value);
      },
      delete: (scope: string, key: string): void =>
        kvDelete(String(scope), String(key)),
      keys: (scope: string): string[] => kvKeys(String(scope)),
      entries: <T = unknown>(scope: string): Array<[string, T]> =>
        kvEntries<T>(String(scope)).map(([key, value]) => [
          key,
          copyStoredValue(value),
        ]),
    },

    // Live-ops flags an operator changes while the server runs, read-only here.
    // Mutation stays on the `flag` command: that path is access-gated and lands
    // in the audit trail, which has to answer "who turned this on" for a switch
    // that changes the game for everyone at once.
    flags: {
      /** The raw value, or undefined when unset or expired. */
      get: (name: string): FlagValue | undefined =>
        getFlag(String(name))?.value,
      /** True only for a flag set to boolean true. */
      enabled: (name: string): boolean => flagEnabled(String(name)),
      /** A numeric flag, or the fallback when it is unset or not a number. */
      number: (name: string, fallback = 0): number =>
        flagNumber(String(name), fallback),
    },

    // Teleport (same map, cross-map, into a copy of an instanced map, or to
    // the instance that runs the map). Gone to another instance, the player
    // is no longer here to write.
    teleportPlayer: (
      player: PlayerServer,
      mapId: string,
      col: number,
      row: number,
    ): void => {
      const position = { x: col * TILE_SIZE, y: row * TILE_SIZE };
      if (!warpToMap(player, String(mapId), position))
        persist(scriptName, player);
    },

    // Messaging
    /**
     * A private line to one player, in the language their client asked for.
     * Translated here, like a command reply, so a script writes the English it
     * means and an untranslated line ships as that English.
     */
    sendMessage: (player: PlayerServer, message: string): void => {
      emitGameEvent({
        type: 'chatPlayer',
        username: player.name,
        payload: {
          type: 'chat',
          scope: 'player',
          message: translate(player, message),
        },
      });
    },
    /**
     * One line to everyone. Not translated: it is one event for every viewer,
     * so a game loops `sendMessage` per player to say it in each language.
     */
    broadcastMessage: (message: string): void => {
      handleChatAction({ type: 'chat', scope: 'global', message });
    },
    /**
     * The senders whose chat this player will not be shown, replacing whatever
     * was set before. Runtime only, and the caller owns the list: state it on
     * join from wherever it is stored, and clear it on leave.
     *
     *     setChatIgnored(player, ['Troll', 'Spammer']);
     */
    setChatIgnored: (player: PlayerServer, names: string[]): void => {
      setIgnored(
        player.name,
        (Array.isArray(names) ? names : [])
          .filter((n) => typeof n === 'string' && n.length > 0)
          .slice(0, 200),
      );
    },

    // Translation
    /**
     * Declare this script's translations, keyed by language and then by the
     * English string it already writes.
     *
     *     i18n({ pt: { 'Pet dismissed.': 'Bicho dispensado.' } });
     */
    i18n: (tables: Record<string, Record<string, string>>): void =>
      registerStrings(tables),
    /**
     * One sentence in a player's language, filling `{placeholders}`.
     * `sendMessage` and a command reply translate on their own, so this is for
     * sentences that carry a value, which a template literal would bake into a
     * string no table can key.
     *
     *     reply(t(player, 'Trades: {count}', { count: offers.length }));
     */
    t: (
      player: PlayerServer | undefined,
      text: string,
      params?: Record<string, string | number>,
    ): string => translate(player, String(text), params),

    // Custom network events (server -> client); pair with on('customAction')
    // for client -> server. `channel` and `payload` are game-defined.
    sendEvent: (
      player: PlayerServer,
      channel: string,
      payload?: unknown,
    ): void => sendCustomEvent(player, String(channel), payload),
    sendMapEvent: (mapId: string, channel: string, payload?: unknown): void =>
      sendMapCustomEvent(String(mapId), String(channel), payload),
    broadcastEvent: (channel: string, payload?: unknown): void =>
      broadcastCustomEvent(String(channel), payload),

    // Outbound HTTP: webhook, alert, community site. Never rejects (a failure
    // is `{ ok: false, error }`), as calls are usually not awaited and an
    // unhandled rejection ends the process. Awaited in a tick handler, it
    // stalls nothing but answers on a later tick.
    httpRequest: (
      url: string,
      options?: HttpRequestOptions,
    ): Promise<HttpResponse> => httpRequest(scriptName, String(url), options),

    // Inter-module API. provide publishes an API under a name; use consumes
    // another module's API. Provided APIs are withdrawn on reload/unload.
    provide: (name: string, api: unknown): void => {
      trackUnsub(provideApi(String(name), api));
    },
    use: <T = unknown>(name: string): T | undefined => useApi<T>(String(name)),

    // Access levels, for command permissions.
    Access,

    // Register a command, runnable from chat (/name) and the REPL (name).
    // command(name, handler) or command(name, { access }, handler).
    command: (
      name: string,
      optsOrHandler: CommandOptions | ((ctx: CommandContext) => void),
      maybeHandler?: (ctx: CommandContext) => void,
    ): void => {
      const opts = typeof optsOrHandler === 'function' ? {} : optsOrHandler;
      const handler =
        typeof optsOrHandler === 'function' ? optsOrHandler : maybeHandler;
      if (!handler) return;
      const unregister = registerCommand(String(name), opts, (ctx) => {
        runWithBudget(scriptName, `command:${name}`, () => {
          observeRejection(handler(ctx), 'command', String(name));
        });
      });
      trackUnsub(unregister);
    },

    // Tick-based scheduling (auto-cancelled on script reload / unload).
    // Ticks, not milliseconds: the simulation's unit is the tick, so anything
    // scheduled this way is captured by the replay recorder and reproduces
    // exactly on re-run. Use msToTicks() when you think in seconds.
    after: (ticks: number, fn: () => void): number => {
      const run = attributed(fn, 'schedule', 'after');
      const id = scheduleAfter(
        ticks,
        () => {
          liveTasks.delete(id);
          run();
        },
        scriptName,
      );
      liveTasks.add(id);
      return id;
    },
    every: (ticks: number, fn: () => void): number => {
      const id = scheduleEvery(
        ticks,
        attributed(fn, 'schedule', 'every'),
        scriptName,
      );
      liveTasks.add(id);
      return id;
    },
    cancel: (id: number): void => {
      cancelScheduled(id);
      liveTasks.delete(id);
    },
    msToTicks,
    TICK_RATE: config.gameLoop.tickRate,

    // Coroutines: a sequence that pauses instead of a chain of callbacks.
    // Cancelled on reload like everything else, or a coroutine from a file
    // that no longer exists would run old code against the new world.
    coroutine: (fn: () => Generator<unknown, unknown, unknown>) => {
      const handle = startCoroutine(scriptName, fn, (ended) =>
        liveCoroutines.delete(ended),
      );
      if (!handle.done) liveCoroutines.add(handle);
      return handle;
    },
    wait,
    waitFor,

    // Deterministic RNG. Always prefer these over Math.random: the sim is
    // seeded (sim/rng.ts), and replay plus determinism.test.ts only hold if
    // every roll that affects the world comes from this sequence.
    random: nextRandom,
    randomInt,
    randomChance,
    randomPick,

    // Wall-clock timers. Deprecated: they fire off the tick, so their effects
    // are invisible to the replay recorder and a replay diverges from the
    // session it recorded. Kept working for compatibility.
    setTimeout: (fn: () => void, ms: number): void => {
      warnWallClockTimer(scriptName, 'setTimeout', 'after');
      const id = setTimeout(() => {
        try {
          fn();
        } catch (e) {
          logger.error(`[script:${scriptName}] setTimeout callback threw`, {
            err: e,
          });
          recordScriptError(scriptName, e, 'timer', 'setTimeout');
        }
      }, ms);
      trackTimer(id);
    },
    setInterval: (fn: () => void, ms: number): TimerId => {
      warnWallClockTimer(scriptName, 'setInterval', 'every');
      const id = setInterval(() => {
        try {
          fn();
        } catch (e) {
          logger.error(`[script:${scriptName}] setInterval callback threw`, {
            err: e,
          });
          recordScriptError(scriptName, e, 'timer', 'setInterval');
        }
      }, ms);
      trackTimer(id);
      return id;
    },
    clearInterval: (id: TimerId): void => clearInterval(id),

    // Logging
    log: (...args: unknown[]): void =>
      logger.info(`[script:${scriptName}] ${args.map(String).join(' ')}`),
    warn: (...args: unknown[]): void =>
      logger.warn(`[script:${scriptName}] ${args.map(String).join(' ')}`),
    error: (...args: unknown[]): void =>
      logger.error(`[script:${scriptName}] ${args.map(String).join(' ')}`),
  };
}
