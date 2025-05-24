import {
  BOOST_MULTIPLIER,
  TILE_SIZE,
  DEFAULT_PLAYER_SPEED,
  MOVE_STEP,
} from '../../shared/constants';
import {
  Key,
  Direction,
  CharacterAction,
  PlayerServer,
  ClientKeyboardAction,
  Tile,
  MapStateServer,
} from '../../shared/types';
import {
  getMap,
  updateMapById,
  getRuntimeState,
  updateMap,
  players,
  pressedKeysMap,
} from '../gameData';
import { lastSentStates } from '../wsServer';
import { handleAttack } from './combatService';
import { pickUpItem } from './inventoryService';
import { insertModeCell, updatePlayerMap } from './mapService';
import { hasCollision, hasWarp } from './physicsService';
import {
  createPlayer,
  getPlayerByName,
  getPlayerByNameFromDb,
  handlePlayerUpdates,
  persistPlayerSessionState,
} from './playerService';

export const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const processMovement = (): void => {
  Object.values(players).forEach((player) => {
    if (!player.moving || !player.targetPosition) {
      if (player.moving) {
        player.moving = false;
        if (player.action === CharacterAction.Walk) {
          player.action = CharacterAction.Idle;
        }
        updatePlayerMap(player.id, player);
      }
      return;
    }
    movePlayerTowardsTarget(player);
  });
};

const movePlayerTowardsTarget = (player: PlayerServer): void => {
  if (!player.targetPosition) {
    player.moving = false;
    if (player.action === CharacterAction.Walk)
      player.action = CharacterAction.Idle;
    updatePlayerMap(player.id, player);
    return;
  }

  const { x: tx, y: ty } = player.targetPosition;

  const dxToTarget = tx - player.position.x;
  const dyToTarget = ty - player.position.y;

  const distance = Math.hypot(dxToTarget, dyToTarget);

  if (distance < 0.01) {
    finalizePlayerMovement(player, { ...player, position: { x: tx, y: ty } });
    return;
  }

  const moveAmount = Math.min(MOVE_STEP * player.speed, distance);

  const angle = Math.atan2(dyToTarget, dxToTarget);

  let nextStepX = player.position.x + Math.cos(angle) * moveAmount;
  let nextStepY = player.position.y + Math.sin(angle) * moveAmount;

  const currentRoundedX = Math.round(player.position.x / TILE_SIZE) * TILE_SIZE;
  if (tx === currentRoundedX && Math.abs(dxToTarget) < TILE_SIZE * 0.5) {
    if (Math.abs(player.position.x - tx) < 0.5) {
      nextStepX = tx;
    }
  }

  const currentRoundedY = Math.round(player.position.y / TILE_SIZE) * TILE_SIZE;
  if (ty === currentRoundedY && Math.abs(dyToTarget) < TILE_SIZE * 0.5) {
    if (Math.abs(player.position.y - ty) < 0.5) {
      nextStepY = ty;
    }
  }

  const proposedStepState: PlayerServer = {
    ...player,
    position: { x: nextStepX, y: nextStepY },
  };

  if (hasCollision(proposedStepState)) {
    finalizePlayerMovement(player, proposedStepState);
  } else {
    player.position.x = nextStepX;
    player.position.y = nextStepY;
    updatePlayerMap(player.id, player);
  }
};

const finalizePlayerMovement = (
  playerStateBeforeStep: PlayerServer,
  attemptedStep: PlayerServer,
): void => {
  let finalX: number;
  let finalY: number;

  const playerToUpdate = players[playerStateBeforeStep.id];
  if (!playerToUpdate) return;

  if (hasCollision(attemptedStep)) {
    finalX =
      Math.round(playerStateBeforeStep.position.x / TILE_SIZE) * TILE_SIZE;
    finalY =
      Math.round(playerStateBeforeStep.position.y / TILE_SIZE) * TILE_SIZE;
  } else if (playerStateBeforeStep.targetPosition) {
    finalX = playerStateBeforeStep.targetPosition.x;
    finalY = playerStateBeforeStep.targetPosition.y;
  } else {
    finalX =
      Math.round(playerStateBeforeStep.position.x / TILE_SIZE) * TILE_SIZE;
    finalY =
      Math.round(playerStateBeforeStep.position.y / TILE_SIZE) * TILE_SIZE;
  }

  playerToUpdate.position.x = finalX;
  playerToUpdate.position.y = finalY;
  playerToUpdate.targetPosition = undefined;
  playerToUpdate.moving = false;
  playerToUpdate.action = CharacterAction.Idle;

  handleWarpAndShops(playerToUpdate);
  updatePlayerMap(playerToUpdate.id, playerToUpdate);
};

const handleWarpAndShops = (player: PlayerServer): void => {
  const warp = hasWarp(player);
  if (warp) {
    player.mapId = warp.to;
    player.position = warp.position;
    player.targetPosition = undefined;
    player.moving = false;
    player.action = CharacterAction.Idle;
  }
};

export const processInputMovement = () => {
  pressedKeysMap.forEach((keySet, username) => {
    const player = getPlayerByName(username);
    if (!player) return;

    const isBoosting = keySet.has(Key.Shift);
    player.speed = DEFAULT_PLAYER_SPEED * (isBoosting ? BOOST_MULTIPLIER : 1.0);

    let activeMoveDir: {
      key: Key;
      dx: number;
      dy: number;
      dir: Direction;
    } | null = null;

    const directions = [
      { key: Key.ArrowUp, dx: 0, dy: -1, dir: Direction.Up },
      { key: Key.ArrowDown, dx: 0, dy: 1, dir: Direction.Down },
      { key: Key.ArrowLeft, dx: -1, dy: 0, dir: Direction.Left },
      { key: Key.ArrowRight, dx: 1, dy: 0, dir: Direction.Right },
    ];

    if (keySet.has(Key.ArrowUp)) {
      activeMoveDir = directions.find((d) => d.key === Key.ArrowUp)!;
    } else if (keySet.has(Key.ArrowDown)) {
      activeMoveDir = directions.find((d) => d.key === Key.ArrowDown)!;
    } else if (keySet.has(Key.ArrowLeft)) {
      activeMoveDir = directions.find((d) => d.key === Key.ArrowLeft)!;
    } else if (keySet.has(Key.ArrowRight)) {
      activeMoveDir = directions.find((d) => d.key === Key.ArrowRight)!;
    }

    if (!activeMoveDir) {
      return;
    }

    player.direction = activeMoveDir.dir;

    const currentGridX = Math.round(player.position.x / TILE_SIZE) * TILE_SIZE;
    const currentGridY = Math.round(player.position.y / TILE_SIZE) * TILE_SIZE;

    const potentialTargetPosition = {
      x: currentGridX + activeMoveDir.dx * TILE_SIZE,
      y: currentGridY + activeMoveDir.dy * TILE_SIZE,
    };

    const shouldSetNewTarget =
      !player.targetPosition ||
      player.targetPosition.x !== potentialTargetPosition.x ||
      player.targetPosition.y !== potentialTargetPosition.y;

    if (shouldSetNewTarget) {
      const proposedPlayerStateForTargetTile: PlayerServer = {
        ...player,
        position: potentialTargetPosition,
      };

      if (!hasCollision(proposedPlayerStateForTargetTile)) {
        player.targetPosition = potentialTargetPosition;
        player.moving = true;
        player.action = CharacterAction.Walk;
      } else {
        player.position.x = currentGridX;
        player.position.y = currentGridY;
        player.moving = false;
        player.targetPosition = undefined;
        player.action = CharacterAction.Idle;
      }
      updatePlayerMap(player.id, player);
    }
  });
};

export const handleKeyAction = (action: ClientKeyboardAction) => {
  const { username, keyboardAction } = action;
  const key = keyboardAction.key;
  const player = getPlayerByName(username);

  if (!player) return;

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
          handleAttack(player);
          updatePlayerMap(player.id, player);
        }
      } else if (key === Key.e) {
        pickUpItem(getMap(player.mapId)!, player).then(() => {
          updatePlayerMap(player.id, player);
        });
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

export const mapSave = async (mapId: string, tiles: Tile[][]) => {
  const newMap = await insertModeCell(mapId, tiles);
  await updateMapById(newMap as MapStateServer);
};

export const getGameState = () => getRuntimeState();

export const login = async (username: string) => {
  const playerExiste = await getPlayerByNameFromDb(username);
  return playerExiste || (await createPlayer(username));
};

export const handlePlayerUpdate = (player: PlayerServer): void => {
  handlePlayerUpdates(player);
};

export const disconnectPlayer = async (username?: string) => {
  const player = username ? getPlayerByName(username) : undefined;
  if (!player) {
    if (username) pressedKeysMap.delete(username);
    return;
  }

  const map = getMap(player.mapId);
  if (map?.players?.[player.id]) {
    delete map.players[player.id];
    updateMap(map);
  }

  if (username) {
    pressedKeysMap.delete(username);
  }

  await persistPlayerSessionState(player);
  if (players[player.id]) {
    delete players[player.id];
    lastSentStates.delete(player.name);
  }
};
