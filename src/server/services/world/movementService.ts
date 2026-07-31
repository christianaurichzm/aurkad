import {
  TILE_SIZE,
  DEFAULT_PLAYER_SPEED,
  MOVEMENT_DURATION,
  RUN_MOVEMENT_DURATION,
} from '../../../shared/constants.js';
import { getTick, msToTicks } from '../../sim/clock.js';
import {
  Key,
  Direction,
  CharacterAction,
  CombatTarget,
  PlayerServer,
  Tile,
  MapStateServer,
  Position,
} from '../../../shared/types.js';
import type { ClientKeyboardAction } from '../../engine/actions.js';
import { isRecording, recordKeyEvent } from '../../sim/replayRecorder.js';
import { useApi } from '../../engine/modules/registry.js';
import { getMap, updatePlayer } from './gameData.js';
import { getAllPlayers } from '../../sim/world.js';
import { emitGameEvent } from '../../engine/eventBus.js';
import { emit } from '../../engine/hooks.js';
import { dispatchEntityScript } from '../../engine/scripting/entityScripts.js';
import { removeItem } from '../economy/economyService.js';
import { handleAttack } from '../combat/index.js';
import { pickUpItem } from '../economy/inventoryService.js';
import { handleInteract } from './interactionService.js';
import { updatePlayerMap, createOrUpdateMap } from './mapService.js';
import { findPlacement, hasCollision, hasWarp } from './physicsService.js';
import {
  getPlayerByName,
  respawnPlayer,
  disconnectPlayer,
} from '../player/playerService.js';
import { handleChatAction } from '../comms/chatService.js';
import { logger } from '../../logger.js';
import { lookupInstanceUrl } from '../../persistence/instanceRegistry.js';
import { playersWsMap } from '../../net/connections.js';

// A player moving through the world: held-key intent each tick, warp, door,
// tile trigger, and the keyboard actions (attack, pickup, interact) sharing
// the held-key bookkeeping. Alongside physicsService (collision) and
// interactionService (NPC talk), this decides where a player ends up.

// Per-player set of currently held keys. Input state, consumed by
// processMovementIntent and handleKeyAction below.
export const pressedKeysMap = new Map<string, Set<Key>>();

/** Drops held-key state for a player leaving, so a disconnect leaks none. */
export function clearPressedKeys(username: string): void {
  pressedKeysMap.delete(username);
}

function resetMovement(player: PlayerServer): void {
  player.targetPosition = undefined;
  player.moving = false;
  player.action = CharacterAction.Idle;
  player.moveTick = undefined;
  player.moveDurationTicks = undefined;
}

function redirectPlayer(
  player: PlayerServer,
  toMapId: string,
  toPosition: Position,
  wsUrl: string,
): void {
  player.mapId = toMapId;
  player.position = toPosition;
  resetMovement(player);
  const ws = playersWsMap.get(player.name);
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type: 'redirect', url: wsUrl }));
    ws.close();
  }
  playersWsMap.delete(player.name);
  pressedKeysMap.delete(player.name);
  disconnectPlayer(player.name).catch((e) =>
    logger.error('[redirect] cleanup failed', { err: e }),
  );
}

function tryWarpToMap(
  player: PlayerServer,
  toMapId: string,
  toPosition: Position,
  previousMapId: string,
): boolean {
  if (!getMap(toMapId)) {
    const url = lookupInstanceUrl(toMapId);
    if (url) {
      redirectPlayer(player, toMapId, toPosition, url);
    } else {
      logger.warn('[warp] no instance found for map', { toMapId });
    }
    return true;
  }
  player.mapId = toMapId;
  // Two players hitting a warp pad in the same second are not stacked: the
  // destination tile decides where they land, not who got there first.
  player.position = findPlacement(player, toMapId, toPosition);
  resetMovement(player);
  updatePlayerMap(player.id, player, previousMapId);
  return false;
}

const runTileTriggers = (
  player: PlayerServer,
  tile: Tile,
  map: MapStateServer,
): void => {
  for (const trigger of tile.triggers ?? []) {
    if (trigger.action === 'heal') {
      player.health = player.maxHealth;
      updatePlayerMap(player.id, player);
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
    } else if (trigger.action === 'sound') {
      emitGameEvent({
        type: 'customPlayer',
        username: player.name,
        channel: 'sound:play',
        payload: { file: trigger.file },
      });
    } else if (trigger.action === 'changeSprite') {
      player.sprite = trigger.spriteId;
      updatePlayerMap(player.id, player);
      updatePlayer(player);
    } else if (trigger.action === 'script') {
      dispatchEntityScript(
        trigger.scriptId,
        'onEnter',
        { player, tile, map },
        trigger.scriptParams,
      );
    }
  }
};

const handleWarpAndShops = (player: PlayerServer): void => {
  const warp = hasWarp(player);
  if (warp) {
    const previousMapId = player.mapId;
    tryWarpToMap(player, warp.to, warp.position, previousMapId);
    return;
  }

  const map = getMap(player.mapId);
  if (map) {
    const tileX = Math.round(player.position.x / TILE_SIZE);
    const tileY = Math.round(player.position.y / TILE_SIZE);
    const tile = map.tiles?.[tileY]?.[tileX];
    if (!tile) return;

    emit('tileEnter', { player, tile, map });
    if (tile.shop) {
      emitGameEvent({
        type: 'openShop',
        username: player.name,
        shopId: tile.shop,
      });
    }
    runTileTriggers(player, tile, map);
  }
};

const DIRECTION_BORDER: Record<
  Direction,
  keyof NonNullable<MapStateServer['borderLinks']>
> = {
  [Direction.Up]: 'up',
  [Direction.Down]: 'down',
  [Direction.Left]: 'left',
  [Direction.Right]: 'right',
};

const tryOpenDoor = (
  player: PlayerServer,
  map: MapStateServer,
  tileY: number,
  tileX: number,
): boolean => {
  const tile = map.tiles[tileY]?.[tileX];
  if (!tile?.door) return false;

  const { requiresItem, openTileIndex } = tile.door;
  if (!removeItem(player.inventory, requiresItem, 1).ok) return false;

  tile.tileIndex = openTileIndex;
  tile.blocked = false;
  tile.door = undefined;
  map.tilesRevision = (map.tilesRevision ?? 0) + 1;

  updatePlayer(player);
  void createOrUpdateMap({
    id: map.id,
    tiles: map.tiles,
    tilesRevision: map.tilesRevision,
  }).catch((e) => {
    logger.error('door map persist failed', { err: e });
  });

  return true;
};

const applyMovement = (
  player: PlayerServer,
  newTarget: Position,
  isBoosting: boolean,
): void => {
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
    const proposedState = {
      id: player.id,
      kind: player.kind,
      mapId: player.mapId,
      width: player.width,
      height: player.height,
      position: newTarget,
    } as CombatTarget;

    if (!hasCollision(proposedState)) {
      applyMovement(player, newTarget, isBoosting);
    } else {
      const map = getMap(player.mapId);
      const tileY = Math.round(newTarget.y / TILE_SIZE);
      const tileX = Math.round(newTarget.x / TILE_SIZE);
      const tile = map?.tiles[tileY]?.[tileX];

      if (tile?.door) {
        if (tryOpenDoor(player, map!, tileY, tileX)) {
          applyMovement(player, newTarget, isBoosting);
        } else {
          player.action = CharacterAction.Idle;
        }
      } else if (tile?.conditionalBlock) {
        const check = useApi<(p: PlayerServer) => boolean>(
          `conditionalBlock.${tile.conditionalBlock}`,
        );
        if (check?.(player)) {
          applyMovement(player, newTarget, isBoosting);
        } else {
          player.action = CharacterAction.Idle;
        }
      } else if (!tile && map?.borderLinks) {
        const borderWarp = map.borderLinks[DIRECTION_BORDER[activeMoveDir]];
        if (borderWarp) {
          tryWarpToMap(
            player,
            borderWarp.to,
            borderWarp.position,
            player.mapId,
          );
        } else {
          player.action = CharacterAction.Idle;
        }
      } else {
        player.action = CharacterAction.Idle;
      }
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

  if (isRecording()) recordKeyEvent(username, key, keyboardAction.type);

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
