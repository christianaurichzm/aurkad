import {
  TILE_SIZE,
  DEFAULT_PLAYER_SPEED,
  MOVEMENT_DURATION,
  RUN_MOVEMENT_DURATION,
} from '../../shared/constants.js';
import { getTick, msToTicks } from '../sim/clock.js';
import {
  Key,
  Direction,
  CharacterAction,
  PlayerServer,
  Tile,
  MapStateServer,
  Position,
  MapType,
} from '../../shared/types.js';
import type { ClientKeyboardAction } from '../engine/actions.js';
import {
  getMap,
  updateMapById,
  getRuntimeState,
  pressedKeysMap,
} from '../gameData.js';
import {
  getAllPlayers,
  getPlayerById,
  unregisterPlayer,
} from '../sim/world.js';
import { clearPlayerDirty } from '../persistence/dirtyPlayers.js';
import { clearAttackCooldown } from './combat/attackCooldown.js';
import {
  resetPlayerNetState,
  broadcastGameState as broadcast,
} from '../net/snapshot.js';
import { playersWsMap } from '../net/connections.js';
import { emitGameEvent } from '../engine/eventBus.js';
import { emit } from '../engine/hooks.js';
import { handleAttack } from './combat/index.js';
import { pickUpItem } from './inventoryService.js';
import { handleInteract } from './interactionService.js';
import { insertModeCell, updatePlayerMap } from './mapService.js';
import { hasCollision, hasWarp } from './physicsService.js';
import {
  getPlayerByName,
  handlePlayerUpdates,
  persistPlayerSessionState,
  respawnPlayer,
} from './playerService.js';
import { handleChatAction } from './chatService.js';
import { logger } from '../logger.js';

const handleWarpAndShops = (player: PlayerServer): void => {
  const warp = hasWarp(player);
  if (warp) {
    const previousMapId = player.mapId;
    player.mapId = warp.to;
    player.position = warp.position;
    player.targetPosition = undefined;
    player.moving = false;
    player.action = CharacterAction.Idle;
    player.moveTick = undefined;
    player.moveDurationTicks = undefined;
    updatePlayerMap(player.id, player, previousMapId);
    return;
  }

  const map = getMap(player.mapId);
  if (map) {
    const tileX = Math.round(player.position.x / TILE_SIZE);
    const tileY = Math.round(player.position.y / TILE_SIZE);
    const tile = map.tiles?.[tileY]?.[tileX];
    if (tile) emit('tileEnter', { player, tile, map });
    if (tile?.shop) {
      emitGameEvent({
        type: 'openShop',
        username: player.name,
        shopId: tile.shop,
      });
    }
    for (const trigger of tile?.triggers ?? []) {
      if (trigger.action === 'heal') {
        player.health = player.maxHealth;
      } else if (trigger.action === 'kill') {
        player.health = 0;
        emit('playerDeath', { player });
        respawnPlayer(player);
        handleChatAction({
          scope: 'global',
          type: 'chat',
          subtype: 'death',
          message: `${player.name} fell into a deadly trap!`,
        });
      } else if (trigger.action === 'message') {
        emitGameEvent({
          type: 'chatPlayer',
          username: player.name,
          payload: { type: 'chat', scope: 'player', message: trigger.text },
        });
      }
    }
  }
};

const calculateNextTilePosition = (
  position: Position,
  dir: Direction,
): Position => {
  const gridX = Math.round(position.x / TILE_SIZE) * TILE_SIZE;
  const gridY = Math.round(position.y / TILE_SIZE) * TILE_SIZE;

  switch (dir) {
    case Direction.Up:
      return { x: gridX, y: gridY - TILE_SIZE };
    case Direction.Down:
      return { x: gridX, y: gridY + TILE_SIZE };
    case Direction.Left:
      return { x: gridX - TILE_SIZE, y: gridY };
    case Direction.Right:
      return { x: gridX + TILE_SIZE, y: gridY };
  }
};

export const processMovementIntent = () => {
  pressedKeysMap.forEach((keySet, username) => {
    const player = getPlayerByName(username);
    if (!player || player.moving) {
      return;
    }

    const isBoosting = keySet.has(Key.Shift);
    let activeMoveDir: Direction | null = null;

    if (keySet.has(Key.ArrowUp)) activeMoveDir = Direction.Up;
    else if (keySet.has(Key.ArrowDown)) activeMoveDir = Direction.Down;
    else if (keySet.has(Key.ArrowLeft)) activeMoveDir = Direction.Left;
    else if (keySet.has(Key.ArrowRight)) activeMoveDir = Direction.Right;

    if (activeMoveDir === null) {
      // Leave an in-progress attack alone (Control release resets it to Idle);
      // otherwise this would overwrite it every tick before the client sees it.
      if (
        player.action !== CharacterAction.Idle &&
        player.action !== CharacterAction.Attack
      ) {
        player.action = CharacterAction.Idle;
      }
      return;
    }

    player.direction = activeMoveDir;
    const newTarget = calculateNextTilePosition(player.position, activeMoveDir);
    const proposedState: PlayerServer = { ...player, position: newTarget };

    if (!hasCollision(proposedState)) {
      player.position = newTarget;
      player.moving = true;

      player.action = isBoosting ? CharacterAction.Run : CharacterAction.Walk;
      player.moveDurationTicks = msToTicks(
        isBoosting ? RUN_MOVEMENT_DURATION : MOVEMENT_DURATION,
      );
      player.moveTick = getTick();
      player.targetPosition = newTarget;

      handleWarpAndShops(player);
      updatePlayerMap(player.id, player);
    } else {
      player.action = CharacterAction.Idle;
    }
  });
};

export const processMovementCompletion = (): void => {
  const tick = getTick();
  getAllPlayers().forEach((player) => {
    const durationTicks =
      player.moveDurationTicks ?? msToTicks(MOVEMENT_DURATION);

    if (
      player.moving &&
      player.moveTick !== undefined &&
      tick - player.moveTick >= durationTicks
    ) {
      player.moving = false;
      player.moveTick = undefined;
      player.targetPosition = undefined;
      player.moveDurationTicks = undefined;

      const keys = pressedKeysMap.get(player.name);
      const isStillTryingToMove =
        keys &&
        (keys.has(Key.ArrowUp) ||
          keys.has(Key.ArrowDown) ||
          keys.has(Key.ArrowLeft) ||
          keys.has(Key.ArrowRight));

      if (!isStillTryingToMove) {
        player.action = CharacterAction.Idle;
      }

      updatePlayerMap(player.id, player);
    }
  });
};

export const handleKeyAction = (action: ClientKeyboardAction) => {
  const { username, keyboardAction, seq } = action;
  const key = keyboardAction.key;
  const player = getPlayerByName(username);

  if (!player) return;

  if (seq !== undefined) {
    player.lastProcessedSeq = seq;
  }

  if (!pressedKeysMap.has(username)) {
    pressedKeysMap.set(username, new Set());
  }
  const keys = pressedKeysMap.get(username)!;

  switch (keyboardAction.type) {
    case 'press': {
      if (keys.has(key)) return;
      keys.add(key);

      if (key === Key.Control) {
        if (player.action !== CharacterAction.Attack) {
          player.action = CharacterAction.Attack;
          handleAttack(player).catch((e) => {
            logger.error('handleAttack failed', { err: e });
          });
          updatePlayerMap(player.id, player);
        }
      } else if (key === Key.e) {
        pickUpItem(getMap(player.mapId)!, player)
          .then(() => {
            updatePlayerMap(player.id, player);
          })
          .catch((e) => {
            logger.error('pickUpItem failed', { err: e });
          });
      } else if (key === Key.f) {
        handleInteract(player);
      }
      break;
    }

    case 'release': {
      keys.delete(key);

      if (key === Key.Control) {
        if (player.action === CharacterAction.Attack) {
          player.action = CharacterAction.Idle;
          updatePlayerMap(player.id, player);
        }
      }
      if (key === Key.Shift) {
        if (
          !keys.has(Key.ArrowUp) &&
          !keys.has(Key.ArrowDown) &&
          !keys.has(Key.ArrowLeft) &&
          !keys.has(Key.ArrowRight)
        ) {
          player.speed = DEFAULT_PLAYER_SPEED;
        }
        updatePlayerMap(player.id, player);
      }

      break;
    }
  }
};

export const mapSave = async (
  mapId: string,
  tiles: Tile[][],
  name: string,
  type: MapType,
) => {
  const newMap = await insertModeCell(mapId, tiles);
  await updateMapById({ ...newMap, name, type } as MapStateServer);
};

export const getGameState = () => getRuntimeState();

export const handlePlayerUpdate = (player: PlayerServer): void => {
  handlePlayerUpdates(player);
};

export async function kickPlayer(
  username: string,
  reason = 'You were kicked from the server.',
): Promise<boolean> {
  const ws = playersWsMap.get(username);
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type: 'kick', message: reason }));
    ws.close();
  }
  playersWsMap.delete(username);
  await disconnectPlayer(username);
  broadcast();
  return true;
}

export const disconnectPlayer = async (username?: string) => {
  const player = username ? getPlayerByName(username) : undefined;
  if (!player) {
    if (username) pressedKeysMap.delete(username);
    return;
  }

  if (username) {
    pressedKeysMap.delete(username);
  }

  await persistPlayerSessionState(player);
  clearPlayerDirty(player.id);
  clearAttackCooldown(player.id);
  if (getPlayerById(player.id)) {
    emit('playerLeave', { player });
    unregisterPlayer(player.id);
    resetPlayerNetState(player.name);
  }
};
