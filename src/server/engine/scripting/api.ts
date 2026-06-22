import { on as hookOn } from '../hooks.js';
import { emitGameEvent } from '../eventBus.js';
import {
  getPlayerByName,
  respawnPlayer,
  awardExperience,
} from '../../services/playerService.js';
import { runtimeState } from '../../sim/state.js';
import { getMap, updatePlayer } from '../../gameData.js';
import { handleChatAction } from '../../services/chatService.js';
import { updatePlayerMap } from '../../services/mapService.js';
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
} from '../../services/customEventService.js';
import { registerCommand } from '../commands.js';
import { provideApi, useApi } from '../modules/registry.js';
import { setCosmetic, clearCosmetic } from '../../services/cosmeticsService.js';
import { spawnNpc, despawnNpc } from '../../services/npc/spawn.js';
import { stepNpcToward } from '../../services/npc/behaviors.js';
import { queryEntitiesInRadius } from '../../spatial/spatialManager.js';
import type { SpawnNpcOptions } from '../../services/npc/spawn.js';
import { resolveDamage, mapPvpMorale } from '../../services/combat/index.js';
import type { CombatTarget, RuntimeNpc } from '../../../shared/types.js';
import { Access } from '../../../shared/types.js';
import type { CommandContext, CommandOptions } from '../commands.js';
import { TILE_SIZE } from '../../../shared/constants.js';
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
        logger.error(`[script:${scriptName}] hook handler threw`, { event, err: e });
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
    moveNpcToward: (npc: RuntimeNpc, x: number, y: number): void =>
      stepNpcToward(npc, { position: { x, y } }),

    // Tile size in pixels (positions are in pixels; tiles are TILE_SIZE apart).
    TILE_SIZE,

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
        player.inventory.items = player.inventory.items.filter((i) => i.item !== itemId);
      persist(scriptName, player);
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
    getPlayerData: <T = unknown>(player: PlayerServer, key: string): T | undefined =>
      (player.data?.[key] as T | undefined),
    setPlayerData: (player: PlayerServer, key: string, value: unknown): void => {
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
    sendEvent: (player: PlayerServer, channel: string, payload?: unknown): void =>
      sendCustomEvent(player, String(channel), payload),
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

    // Timers (auto-cleaned on script reload / unload)
    setTimeout: (fn: () => void, ms: number): void => {
      const id = setTimeout(() => {
        try {
          fn();
        } catch (e) {
          logger.error(`[script:${scriptName}] setTimeout callback threw`, { err: e });
        }
      }, ms);
      trackTimer(id as unknown as TimerId);
    },
    setInterval: (fn: () => void, ms: number): TimerId => {
      const id = setInterval(() => {
        try {
          fn();
        } catch (e) {
          logger.error(`[script:${scriptName}] setInterval callback threw`, { err: e });
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
