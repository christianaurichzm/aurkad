import {
  TILE_SIZE,
  MOVEMENT_DURATION,
  RUN_MOVEMENT_DURATION,
} from '../../../shared/constants.js';
import {
  mapPixelHeight,
  mapPixelWidth,
  tileAt,
} from '../../../shared/mapGeometry.js';
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
  BorderLink,
} from '../../../shared/types.js';
import type {
  ClientKeyboardAction,
  ClientMoveToAction,
} from '../../engine/actions.js';
import { getAllPlayers, getMap, updatePlayer } from '../../sim/world.js';
import { emitGameEvent } from '../../engine/eventBus.js';
import { emit } from '../../engine/hooks.js';
import { dispatchEntityScript } from '../../engine/scripting/entityScripts.js';
import { removeItem } from '../economy/economyService.js';
import { handleAttack, killPlayer, swing } from '../combat/index.js';
import { pickUpItem } from '../economy/inventoryService.js';
import { handleInteract } from './interactionService.js';
import { bfsNextStep } from '../npc/behaviors.js';
import { updatePlayerMap, createOrUpdateMap } from './mapService.js';
import { findPlacement, hasCollision, hasWarp } from './physicsService.js';
import { getPlayerByName, disconnectPlayer } from '../player/playerService.js';
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

// Per-player cell a click asked to walk to, followed a step a tick by
// processMovementIntent until the player is there, an arrow key takes over or
// the way is shut. Input state like the held keys: never saved, gone with the
// socket or the next warp. `avoid` collects the cells someone was found
// standing on, so the way round them is kept rather than retried every step.
const pathGoals = new Map<
  string,
  { col: number; row: number; avoid: Position[] }
>();

// How far round a clicked cell is looked for. Wider than an npc's hunt
// (DEFAULT_PATH_DEPTH): a click lands anywhere on the screen, and the way
// there can bend round a wall.
const CLICK_PATH_DEPTH = 64;

/** Forgets every walk in progress: a fresh simulation starts with none. */
export function clearAllPathGoals(): void {
  pathGoals.clear();
}

/** Players holding keys and walking to a clicked cell, as metrics. */
export function movementStateCounts(): { heldKeys: number; pathGoals: number } {
  return { heldKeys: pressedKeysMap.size, pathGoals: pathGoals.size };
}

export function clearPressedKeys(username: string): void {
  pressedKeysMap.delete(username);
  pathGoals.delete(username);
}

function resetMovement(player: PlayerServer): void {
  pathGoals.delete(player.name);
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
 * The map has to be loaded here; a destination on another instance belongs
 * to `warpToMap`, which every caller that might name one (a warp tile, an
 * operator's tp) goes through.
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

/**
 * Warp, plus the one arrival teleportPlayer cannot do: another instance.
 *
 * True when the player left this process, so a caller that wanted to tell them
 * something, or to write them, knows there is nobody here to tell.
 */
export function warpToMap(
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
    if (!url) {
      // Nowhere to send them, so they are still here: a map no live instance
      // claims is a broken warp, not a hand-off.
      logger.warn('[warp] no instance found for map', { toMapId });
      return false;
    }
    redirectPlayer(player, toMapId, toPosition, url);
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
      const left = killPlayer(player);
      handleChatAction({
        scope: 'global',
        type: 'chat',
        subtype: 'death',
        message: `${player.name} fell into a deadly trap!`,
      });
      // Respawned on another instance: the rest of this tile is not theirs.
      if (left) return;
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
    warpToMap(player, warp.to, warp.position);
    return;
  }

  const map = getMap(player.mapId);
  if (map) {
    const tile = tileAt(map.tiles, player.position);
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

/**
 * Where walking off `map` toward `dir` lands: the opposite edge of the linked
 * map, level with the tile left from plus the link's offset. findPlacement
 * pulls it onto a smaller map and off a blocked tile.
 */
function borderLanding(
  dir: Direction,
  from: Position,
  link: BorderLink,
): Position {
  if (link.position) return link.position;
  const tiles = getMap(link.to)?.tiles;
  // A remote map's dimensions are known only on arrival. A finite position
  // beyond its far edge lets enterWorld clamp to that edge on the destination.
  const farX = tiles
    ? mapPixelWidth(tiles) - TILE_SIZE
    : Number.MAX_SAFE_INTEGER;
  const farY = tiles
    ? mapPixelHeight(tiles) - TILE_SIZE
    : Number.MAX_SAFE_INTEGER;
  const shift = (link.offset ?? 0) * TILE_SIZE;
  switch (dir) {
    case Direction.Left:
      return { x: farX, y: from.y + shift };
    case Direction.Right:
      return { x: 0, y: from.y + shift };
    case Direction.Up:
      return { x: from.x + shift, y: farY };
    case Direction.Down:
      return { x: from.x + shift, y: 0 };
  }
}

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
        // Opening it does not clear whoever stands in the doorway.
        if (
          tryOpenDoor(player, map!, tileY, tileX) &&
          !hasCollision(proposedState)
        ) {
          applyMovement(player, newTarget, isBoosting);
        } else {
          player.action = CharacterAction.Idle;
        }
      } else if (!tile && map?.borderLinks) {
        const link = map.borderLinks[DIRECTION_BORDER[activeMoveDir]];
        if (link) {
          warpToMap(
            player,
            link.to,
            borderLanding(activeMoveDir, player.position, link),
          );
        } else {
          player.action = CharacterAction.Idle;
        }
      } else {
        player.action = CharacterAction.Idle;
      }
    }
  });

  pathGoals.forEach((goal, username) => {
    const player = getPlayerByName(username);
    if (!player) pathGoals.delete(username);
    else if (!player.moving) followPath(player, goal);
  });
};

const isArrow = (key: Key) =>
  key === Key.ArrowUp ||
  key === Key.ArrowDown ||
  key === Key.ArrowLeft ||
  key === Key.ArrowRight;

/**
 * One step on the shortest way to the clicked cell. Someone standing on
 * that step is walked round when another way exists. Otherwise (the goal
 * is a clicked npc, door or wall, or someone stands in a gate) the walk
 * ends there, turned toward it, so the next attack or F lands on it.
 */
function followPath(
  player: PlayerServer,
  goal: { col: number; row: number; avoid: Position[] },
) {
  const map = getMap(player.mapId);
  if (!map) {
    pathGoals.delete(player.name);
    return;
  }
  const goalAt = { x: goal.col * TILE_SIZE, y: goal.row * TILE_SIZE };
  const occupied = (position: { x: number; y: number }) =>
    hasCollision({
      id: player.id,
      kind: player.kind,
      mapId: player.mapId,
      width: player.width,
      height: player.height,
      position,
    } as CombatTarget);
  const plan = () =>
    bfsNextStep(
      player.position,
      goalAt,
      map,
      CLICK_PATH_DEPTH,
      player,
      goal.avoid,
    );
  let step = plan();
  if (step && occupied(step)) {
    goal.avoid.push(step);
    step = plan() ?? step;
  }
  if (!step) {
    // There, or no way there within reach.
    pathGoals.delete(player.name);
    return;
  }
  player.direction = step.dir;
  const target = { x: step.x, y: step.y };
  if (occupied(target)) {
    // Something stands on the way, or on the goal itself: stop, facing it.
    // An attack queued behind the click keeps its pose until Control is let go.
    pathGoals.delete(player.name);
    if (player.action !== CharacterAction.Attack) {
      player.action = CharacterAction.Idle;
    }
    updatePlayerMap(player.id, player);
    return;
  }
  applyMovement(player, target, false);
}

/**
 * Walk to a cell. The walk itself happens in the tick (processMovementIntent);
 * a cell right beside the player is turned to here, at once, so an attack or
 * an F queued behind the click is aimed at it.
 */
export const handleMoveTo = ({ username, col, row }: ClientMoveToAction) => {
  const player = getPlayerByName(username);
  const map = player && getMap(player.mapId);
  if (!player || !map?.tiles[row]?.[col]) return;
  pathGoals.set(username, { col, row, avoid: [] });
  if (player.moving) return;
  const dc = col - Math.round(player.position.x / TILE_SIZE);
  const dr = row - Math.round(player.position.y / TILE_SIZE);
  if (Math.abs(dc) + Math.abs(dr) !== 1) return;
  player.direction =
    dc > 0
      ? Direction.Right
      : dc < 0
        ? Direction.Left
        : dr > 0
          ? Direction.Down
          : Direction.Up;
  updatePlayerMap(player.id, player);
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
      if (isArrow(key)) pathGoals.delete(username);

      if (key === Key.Control) {
        swing(player);
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
      break;
    }
  }
};
