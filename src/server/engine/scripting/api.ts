import { on as hookOn } from '../hooks.js';
import { emitGameEvent } from '../eventBus.js';
import {
  getPlayerByName,
  respawnPlayer,
  awardExperience,
  persistPlayersNow,
} from '../../services/player/playerService.js';
import { runtimeState } from '../../sim/state.js';
import {
  flagEnabled,
  flagNumber,
  getFlag,
  type FlagValue,
} from '../../services/liveOpsService.js';
import { getMap, updatePlayer } from '../../services/world/gameData.js';
import { handleChatAction } from '../../services/comms/chatService.js';
import { setIgnored } from '../../services/world/serverState.js';
import { updatePlayerMap } from '../../services/world/mapService.js';
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
import { getItemById } from '../../services/economy/inventoryService.js';
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
import { cachedQuests } from '../../services/content/questService.js';
import { cachedRecipes } from '../../services/content/recipeService.js';
import { queryEntitiesInRadius } from '../../spatial/spatialManager.js';
import type { SpawnNpcOptions } from '../../services/npc/spawn.js';
import { resolveDamage, mapPvpMorale } from '../../services/combat/index.js';
import { findPlacement } from '../../services/world/physicsService.js';
import type {
  CombatTarget,
  Dialog,
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
import { CharacterAction } from '../../../shared/types.js';
import { logger } from '../../logger.js';
import { recordScriptError, type ScriptErrorSource } from './scriptErrors.js';
import { runWithBudget } from './handlerBudget.js';
import {
  httpRequest,
  type HttpRequestOptions,
  type HttpResponse,
} from './httpOut.js';
import { startCoroutine, wait, waitFor } from './coroutines.js';
import {
  registerEntityBehavior,
  type EntityBehavior,
} from './entityScripts.js';
import type { HookMap } from '../hooks.js';
import type { InventoryLike, PlayerServer } from '../../../shared/types.js';

// Mutations go through updatePlayer so state is marked dirty (persisted by the
// snapshot loop) and broadcast to clients on the next tick. No DB write happens
// here, which is why scripts can call it from inside a synchronous hook.
function persist(_scriptName: string, player: PlayerServer): void {
  updatePlayer(player);
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

export type ScriptApi = ReturnType<typeof buildApi>;

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
        runWithBudget(scriptName, `${source}:${context}`, fn);
      } catch (e) {
        recordScriptError(scriptName, e, source, context);
        throw e;
      }
    };
  }

  function safeOn(event: keyof HookMap, handler: AnyHandler): Cleanup {
    const wrapped = (payload: unknown) => {
      try {
        // Timed and, if it keeps overrunning, dropped: one slow handler on a
        // hot hook like `tick` costs the whole server its frame.
        runWithBudget(scriptName, `on:${event}`, () => handler(payload));
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

    // { blocked } for the tile at (col, row) on the map, or null out of
    // bounds. For modules that check walkability (knockback, LOS).
    getMapTile: (mapId: string, col: number, row: number) => {
      const tile = getMap(String(mapId))?.tiles[Math.floor(row)]?.[
        Math.floor(col)
      ];
      return tile ? { blocked: tile.blocked ?? false } : null;
    },

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

    // Every authored quest, copied for the same reason getDialog copies. The
    // whole list rather than one by id: the quest module registers all of them
    // at load, and asking for them one at a time would need a second call just
    // to learn the ids.
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
      visualTarget: 'self' | 'targets';
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
        visualTarget?: 'self' | 'targets';
      }[],
    ): void => {
      const run = async () => {
        for (const spell of spellList) {
          await createOrUpdateSpell({
            name: spell.name,
            description: spell.description ?? '',
            sprite: Number(spell.sprite),
            mpCost: Number(spell.mpCost),
            damage: Number(spell.damage),
            cooldownMs: Number(spell.cooldownMs),
            visualTarget:
              spell.visualTarget ?? (spell.damage > 0 ? 'targets' : 'self'),
          });
        }
      };
      void run().catch((e) =>
        logger.error(`[script:${scriptName}] createSpells failed`, { err: e }),
      );
    },

    // Item metadata lookup, with arrowId for ranged weapons.
    getItem: (
      id: number,
    ):
      | {
          id: number;
          name: string;
          type: string;
          arrowId?: number;
          bound?: boolean;
        }
      | undefined => {
      const item = getItemById(Number(id));
      if (!item) return undefined;
      return {
        id: item.id,
        name: item.name,
        type: item.type,
        ...(item.arrowId != null && { arrowId: item.arrowId }),
        ...(item.bound != null && { bound: item.bound }),
      };
    },

    // Inventory. These return whether they happened, so a script can tell a
    // delivered reward from one lost to a full bag or a short stack.
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
    persistNow: (...playersToSave: PlayerServer[]): void => {
      void persistPlayersNow(playersToSave.filter((p) => !!p));
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
    healPlayer: (player: PlayerServer): void => {
      player.health = player.maxHealth;
      persist(scriptName, player);
    },
    killPlayer: (player: PlayerServer): void => {
      player.health = 0;
      respawnPlayer(player);
      persist(scriptName, player);
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

    // Cosmetic tag above the name (a guild name, say); undefined clears it.
    setNameTag: (player: PlayerServer, tag: string | undefined): void => {
      if (tag === undefined) clearCosmetic(player, 'nameTag', 'base');
      else setCosmetic(player, 'nameTag', 'base', tag, 0);
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
      if (!check.ok) {
        logger.warn(
          `[script:${scriptName}] setPlayerData("${key}") refused: ${explainLimit(check)}`,
        );
        return false;
      }
      (player.data ??= {})[String(key)] = value;
      persist(scriptName, player);
      return true;
    },

    // Scoped key-value store (shared, persisted). Reads/writes are synchronous.
    // `get` copies for the same reason getPlayerData does.
    store: {
      get: <T = unknown>(scope: string, key: string): T | undefined =>
        copyStoredValue(kvGet(String(scope), String(key))),
      set: (scope: string, key: string, value: unknown): boolean =>
        kvSet(String(scope), String(key), value),
      delete: (scope: string, key: string): void =>
        kvDelete(String(scope), String(key)),
      keys: (scope: string): string[] => kvKeys(String(scope)),
      entries: <T = unknown>(scope: string): Array<[string, T]> =>
        kvEntries<T>(String(scope)),
    },

    // Live-ops flags an operator changes while the server runs, read-only here.
    // Mutation stays on the `flag` command: that path is access-gated and lands
    // in the audit trail, and "who turned this on" is the whole point of a
    // switch that changes the game for everyone at once.
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

    // Teleport (same map or cross-map)
    teleportPlayer: (
      player: PlayerServer,
      mapId: string,
      col: number,
      row: number,
    ): void => {
      const previousMapId = player.mapId;
      player.mapId = mapId;
      // Lands beside the tile when it is taken rather than on top of whoever
      // is standing there; still lands when nothing is free.
      player.position = findPlacement(player, mapId, {
        x: col * TILE_SIZE,
        y: row * TILE_SIZE,
      });
      player.targetPosition = undefined;
      player.moving = false;
      player.action = CharacterAction.Idle;
      player.moveTick = undefined;
      player.moveDurationTicks = undefined;
      updatePlayerMap(player.id, player, previousMapId);
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
        runWithBudget(scriptName, `command:${name}`, () => handler(ctx));
      });
      trackUnsub(unregister);
    },

    // Tick-based scheduling (auto-cancelled on script reload / unload).
    // Ticks, not milliseconds: the simulation's unit is the tick, so anything
    // scheduled this way is captured by the replay recorder and reproduces
    // exactly on re-run. Use msToTicks() when you think in seconds.
    after: (ticks: number, fn: () => void): number => {
      const id = scheduleAfter(
        ticks,
        attributed(fn, 'schedule', 'after'),
        scriptName,
      );
      trackUnsub(() => cancelScheduled(id));
      return id;
    },
    every: (ticks: number, fn: () => void): number => {
      const id = scheduleEvery(
        ticks,
        attributed(fn, 'schedule', 'every'),
        scriptName,
      );
      trackUnsub(() => cancelScheduled(id));
      return id;
    },
    cancel: (id: number): void => cancelScheduled(id),
    msToTicks,
    TICK_RATE: config.gameLoop.tickRate,

    // Coroutines: a sequence that pauses instead of a chain of callbacks.
    // Cancelled on reload like everything else, or a coroutine from a file
    // that no longer exists would run old code against the new world.
    coroutine: (fn: () => Generator<unknown, unknown, unknown>) => {
      const handle = startCoroutine(scriptName, fn);
      trackUnsub(() => handle.cancel());
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
