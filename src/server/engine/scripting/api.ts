import { on as hookOn } from '../hooks.js';
import { emitGameEvent } from '../eventBus.js';
import { getPlayerByName, respawnPlayer } from '../../services/playerService.js';
import { runtimeState } from '../../sim/state.js';
import { updatePlayer } from '../../gameData.js';
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
