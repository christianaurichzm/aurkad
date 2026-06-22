import { on as hookOn } from '../hooks.js';
import { emitGameEvent } from '../eventBus.js';
import { getPlayerByName, respawnPlayer } from '../../services/playerService.js';
import { runtimeState } from '../../sim/state.js';
import { handleChatAction } from '../../services/chatService.js';
import { updatePlayerMap } from '../../services/mapService.js';
import { TILE_SIZE } from '../../../shared/constants.js';
import { CharacterAction } from '../../../shared/types.js';
import { logger } from '../../logger.js';
import type { HookMap } from '../hooks.js';
import type { PlayerServer } from '../../../shared/types.js';

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
      }
    },
    removeItem: (player: PlayerServer, itemId: number, quantity = 1): void => {
      const slot = player.inventory.items.find((i) => i.item === itemId);
      if (!slot) return;
      slot.quantity -= quantity;
      if (slot.quantity <= 0)
        player.inventory.items = player.inventory.items.filter((i) => i.item !== itemId);
    },

    // Health
    healPlayer: (player: PlayerServer): void => {
      player.health = player.maxHealth;
    },
    killPlayer: (player: PlayerServer): void => {
      player.health = 0;
      respawnPlayer(player);
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
