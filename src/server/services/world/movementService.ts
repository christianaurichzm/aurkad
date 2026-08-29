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
import {
  enterInstance,
  forgetEntrance,
  isInstanceKey,
  isInstancedMap,
} from './instanceService.js';
import { formatTraceparent, startSpan } from '../../tracing.js';
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

  // The one hop in this engine that crosses a process boundary. A root span,
  // not a child: nothing that reaches here came from an HTTP request, and the
  // trace id travels with the redirect so the arrival on the other instance
  // lands inside this trace instead of starting a second, unrelated one.
  const span = startSpan('warp.handoff', {
    kind: 'client',
    attributes: {
      'player.name': player.name,
      'map.to': toMapId,
      'server.address': wsUrl,
    },
  });

  const ws = playersWsMap.get(player.name);
  playersWsMap.delete(player.name);
  pressedKeysMap.delete(player.name);

  // The client is told where to go only once this side has finished: the
  // instance it lands on builds the player from the document, so the last
  // write must be in it and the lease gone. Told first, the arrival can win
  // the race and read a character seconds stale, and the flush here would
  // then overwrite whatever it did there.
  disconnectPlayer(player.name)
    .catch((e) => logger.error('[redirect] cleanup failed', { err: e }))
    .finally(() => {
      if (ws && ws.readyState === ws.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'redirect',
            url: wsUrl,
            traceparent: formatTraceparent(span.context),
          }),
        );
        ws.close();
      } else {
        // No socket to tell: the player is gone and will never arrive, which is
        // worth seeing as a failed hand-off rather than half of one.
        span.fail('no open socket to redirect');
      }
      span.end();
    });
}

/**
 * Puts a player somewhere else at once, without walking there. Every
 * arrival that is not a step ends here: a warp pad, a GM bring, goto, warp
 * or gomap, tp from the console. The tile asked for decides where they
 * land, not who got there first, so an operator never lands in a wall or
 * on top of the player they were looking for.
 *
 * The map has to be loaded here; a destination on another instance is the
 * warp path's, because only a player who walked into it can be redirected.
 */
export function teleportPlayer(
  player: PlayerServer,
  toMapId: string,
  toPosition: Position,
): void {
  const previousMapId = player.mapId;
  player.mapId = toMapId;
  player.position = findPlacement(player, toMapId, toPosition);
  resetMovement(player);
  updatePlayerMap(player.id, player, previousMapId);
  // Out of the dungeon and back into the world: the way in is only worth
  // remembering while they are inside it.
  if (!isInstanceKey(toMapId)) forgetEntrance(player.id);
}

/** Warp, plus the one arrival teleportPlayer cannot do: another instance. */
function tryWarpToMap(
  player: PlayerServer,
  toMapId: string,
  toPosition: Position,
): boolean {
  // A warp to an instanced map is a warp to somebody's copy of it. Which copy
  // is the instance service's answer; if it has none, the map is not on this
  // process and the redirect below is the right one after all.
  if (isInstancedMap(toMapId)) {
    const key = enterInstance(player, toMapId);
    if (key) {
      teleportPlayer(player, key, toPosition);
      return false;
    }
  }

  if (!getMap(toMapId)) {
    const url = lookupInstanceUrl(toMapId);
    if (url) {
      redirectPlayer(player, toMapId, toPosition, url);
    } else {
      logger.warn('[warp] no instance found for map', { toMapId });
    }
    return true;
  }
  teleportPlayer(player, toMapId, toPosition);
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
    tryWarpToMap(player, warp.to, warp.position);
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
          tryWarpToMap(player, borderWarp.to, borderWarp.position);
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
          // Emitted before the melee runs, because the cooldown and the target
          // rule inside it are the policy a replacement wants to own. The pose
          // is set first so a handler reads the state it is being told about,
          // the same order the equip hooks use.
          const attack = { player, handled: false };
          emit('playerAttack', attack);
          if (!attack.handled) {
            handleAttack(player);
          }
          updatePlayerMap(player.id, player);
        }
      } else if (key === Key.e) {
        pickUpItem(getMap(player.mapId)!, player);
        updatePlayerMap(player.id, player);
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
