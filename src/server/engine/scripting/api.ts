import { on as hookOn } from '../hooks.js';
import { emitGameEvent } from '../eventBus.js';
import {
  getPlayerByName,
  respawnPlayer,
  awardExperience,
  persistPlayersNow,
} from '../../services/player/playerService.js';
import { runtimeState } from '../../sim/state.js';
import { getMap, updatePlayer } from '../../services/world/gameData.js';
import { handleChatAction } from '../../services/comms/chatService.js';
import { updatePlayerMap } from '../../services/world/mapService.js';
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
import { provideApi, useApi } from '../modules/registry.js';
import {
  setCosmetic,
  clearCosmetic,
} from '../../services/player/cosmeticsService.js';
import { spawnNpc, despawnNpc } from '../../services/npc/spawn.js';
import { stepNpcToward } from '../../services/npc/behaviors.js';
import { getItemById } from '../../services/economy/inventoryService.js';
import {
  getArrowSync,
  getAllArrows,
} from '../../services/content/arrowService.js';
import {
  getAllSpells,
  createOrUpdateSpell,
} from '../../services/content/spellService.js';
import { queryEntitiesInRadius } from '../../spatial/spatialManager.js';
import type { SpawnNpcOptions } from '../../services/npc/spawn.js';
import { resolveDamage, mapPvpMorale } from '../../services/combat/index.js';
import type { CombatTarget, RuntimeNpc } from '../../../shared/types.js';
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
import type { HookMap } from '../hooks.js';
import type { PlayerServer } from '../../../shared/types.js';

// Mutations go through updatePlayer so state is marked dirty (persisted by the
// snapshot loop) and broadcast to clients on the next tick. Fire-and-forget:
// scripts run synchronously inside hooks, so we don't await DB writes here.
function persist(scriptName: string, player: PlayerServer): void {
  void updatePlayer(player).catch((e) =>
    logger.error(`[script:${scriptName}] persist failed`, { err: e }),
  );
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
  function safeOn(event: keyof HookMap, handler: AnyHandler): Cleanup {
    const wrapped = (payload: unknown) => {
      try {
        handler(payload);
      } catch (e) {
        logger.error(`[script:${scriptName}] hook handler threw`, {
          event,
          err: e,
        });
      }
    };
    const unsub = hookOn(event, wrapped as any);
    trackUnsub(unsub);
    return unsub;
  }

  return {
    // Hooks
    on: safeOn,

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
    // you can drive it from on('tick') (e.g. move it toward its owner).
    spawnNpc: (opts: SpawnNpcOptions): RuntimeNpc | undefined =>
      spawnNpc({ ...opts, mapId: String(opts.mapId) }),
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

    // Inventory
    giveItem: (player: PlayerServer, itemId: number, quantity = 1): void => {
      const existing = player.inventory.items.find((i) => i.item === itemId);
      if (existing) {
        existing.quantity += quantity;
      } else if (player.inventory.items.length < player.inventory.maxCapacity) {
        player.inventory.items.push({ item: itemId, quantity });
      } else {
        return;
      }
      persist(scriptName, player);
    },
    removeItem: (player: PlayerServer, itemId: number, quantity = 1): void => {
      const slot = player.inventory.items.find((i) => i.item === itemId);
      if (!slot) return;
      slot.quantity -= quantity;
      if (slot.quantity <= 0)
        player.inventory.items = player.inventory.items.filter(
          (i) => i.item !== itemId,
        );
      persist(scriptName, player);
    },

    // Economic commit: persist these players now instead of waiting for the
    // snapshot loop, so a crash cannot revert a confirmed transfer.
    persistNow: (...playersToSave: PlayerServer[]): void => {
      void persistPlayersNow(playersToSave.filter((p) => !!p));
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
      void resolveDamage(target, amount, {
        attacker: attacker ?? undefined,
        map: getMap(target.mapId),
      }).catch((e) =>
        logger.error(`[script:${scriptName}] dealDamage failed`, { err: e }),
      );
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

    // Per-player custom data (persisted with the player record)
    getPlayerData: <T = unknown>(
      player: PlayerServer,
      key: string,
    ): T | undefined => player.data?.[key] as T | undefined,
    setPlayerData: (
      player: PlayerServer,
      key: string,
      value: unknown,
    ): void => {
      (player.data ??= {})[key] = value;
      persist(scriptName, player);
    },

    // Scoped key-value store (shared, persisted). Reads/writes are synchronous.
    store: {
      get: <T = unknown>(scope: string, key: string): T | undefined =>
        kvGet<T>(String(scope), String(key)),
      set: (scope: string, key: string, value: unknown): void =>
        kvSet(String(scope), String(key), value),
      delete: (scope: string, key: string): void =>
        kvDelete(String(scope), String(key)),
      keys: (scope: string): string[] => kvKeys(String(scope)),
      entries: <T = unknown>(scope: string): Array<[string, T]> =>
        kvEntries<T>(String(scope)),
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
      player.position = { x: col * TILE_SIZE, y: row * TILE_SIZE };
      player.targetPosition = undefined;
      player.moving = false;
      player.action = CharacterAction.Idle;
      player.moveTick = undefined;
      player.moveDurationTicks = undefined;
      updatePlayerMap(player.id, player, previousMapId);
      persist(scriptName, player);
    },

    // Messaging
    sendMessage: (player: PlayerServer, message: string): void => {
      emitGameEvent({
        type: 'chatPlayer',
        username: player.name,
        payload: { type: 'chat', scope: 'player', message },
      });
    },
    broadcastMessage: (message: string): void => {
      handleChatAction({ type: 'chat', scope: 'global', message });
    },

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
      const unregister = registerCommand(String(name), opts, handler);
      trackUnsub(unregister);
    },

    // Tick-based scheduling (auto-cancelled on script reload / unload).
    // Ticks, not milliseconds: the simulation's unit is the tick, so anything
    // scheduled this way is captured by the replay recorder and reproduces
    // exactly on re-run. Use msToTicks() when you think in seconds.
    after: (ticks: number, fn: () => void): number => {
      const id = scheduleAfter(ticks, fn, scriptName);
      trackUnsub(() => cancelScheduled(id));
      return id;
    },
    every: (ticks: number, fn: () => void): number => {
      const id = scheduleEvery(ticks, fn, scriptName);
      trackUnsub(() => cancelScheduled(id));
      return id;
    },
    cancel: (id: number): void => cancelScheduled(id),
    msToTicks,
    TICK_RATE: config.gameLoop.tickRate,

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
        }
      }, ms);
      trackTimer(id as unknown as TimerId);
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
