import {
  BOOST_MULTIPLIER,
  DEFAULT_PLAYER_SPEED,
  GAME_HEIGHT,
  GAME_WIDTH,
  TILE_SIZE,
} from '../shared/constants';
import {
  Player,
  Key,
  Direction,
  PlayerAction,
  Character,
  Tile,
  MapState,
  Warp,
  EnemiesMap,
  ClientChatAction,
  Enemy,
} from '../shared/types';
import {
  getEnemies,
  getGameStateDb,
  getMap,
  getPlayer,
  getPlayers,
  updateMap,
  updateMapById,
  updatePlayer,
} from './database';
import { isEnemy, respawnEnemy } from './enemyService';
import {
  createPlayer,
  handlePlayerUpdates,
  isPlayer,
  levelUpPlayer,
  respawnPlayer,
} from './playerService';
import { broadcast, broadcastChat, broadcastLocalChat } from './wsServer';

const isColliding = (a: Character, b: Character): boolean =>
  a.position.x < b.position.x + b.width &&
  a.position.x + a.width > b.position.x &&
  a.position.y < b.position.y + b.height &&
  a.position.y + a.height > b.position.y;

const isTileBlocked = (map: MapState, x: number, y: number): boolean => {
  const row = Math.floor(y / TILE_SIZE);
  const col = Math.floor(x / TILE_SIZE);
  return !!map.tiles[row]?.[col]?.blocked;
};

const isTileWarp = (map: MapState, x: number, y: number): Warp | undefined => {
  const row = Math.floor(y / TILE_SIZE);
  const col = Math.floor(x / TILE_SIZE);
  return map.tiles[row]?.[col]?.warp;
};

export const insertEnemies = (mapId: string, tiles: Tile[][]) => {
  const newMap = { ...getMap(mapId), tiles, enemies: {} as EnemiesMap };
  tiles.forEach((row, rowIndex) =>
    row.forEach((tile, colIndex) => {
      if (tile.enemySpawn) {
        const enemy = {
          ...getEnemies()[tile.enemySpawn],
          position: { x: colIndex * TILE_SIZE, y: rowIndex * TILE_SIZE },
          mapId,
        };
        newMap.enemies[
          String.fromCharCode(65 + Math.floor(Math.random() * 26))
        ] = enemy;
      }
    }),
  );
  return newMap;
};

export const hasCollision = (character: Character): boolean => {
  if (!character.mapId) return false;

  const map = getMap(character.mapId)!;
  const { players, enemies } = map;
  const { width, height } = character;
  const { x, y } = character.position;

  const characterCollision = [
    ...Object.values(enemies),
    ...Object.values(players),
  ].some((other) => other.id !== character.id && isColliding(character, other));

  const tileCollision = [
    isTileBlocked(map, x, y),
    isTileBlocked(map, x + width - 1, y),
    isTileBlocked(map, x, y + height - 1),
    isTileBlocked(map, x + width - 1, y + height - 1),
  ].some(Boolean);

  const borderCollision =
    x < 0 || y < 0 || x + width > GAME_WIDTH || y + height > GAME_HEIGHT;

  return characterCollision || tileCollision || borderCollision;
};

const hasWarp = (character: Character): Warp | undefined => {
  if (!character.mapId) return undefined;

  const map = getMap(character.mapId)!;
  const { width, height } = character;
  const { x, y } = character.position;

  return [
    isTileWarp(map, x, y),
    isTileWarp(map, x + width - 1, y),
    isTileWarp(map, x, y + height - 1),
    isTileWarp(map, x + width - 1, y + height - 1),
  ].find(Boolean);
};

export const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

let isActing = false;

export const handleKeyPress = async (username: string, key: Key) => {
  if (isActing) return;
  isActing = true;

  const player = getPlayerByName(username);
  if (player) {
    const newState = { ...player };
    const proposedState = { ...newState, position: { ...newState.position } };

    switch (key) {
      case Key.Shift:
        newState.speed *= BOOST_MULTIPLIER;
        break;
      case Key.ArrowUp:
        updatePlayerPositionAndDirection(
          newState,
          proposedState,
          Direction.Up,
          0,
          -TILE_SIZE,
        );
        break;
      case Key.ArrowDown:
        updatePlayerPositionAndDirection(
          newState,
          proposedState,
          Direction.Down,
          0,
          TILE_SIZE,
        );
        break;
      case Key.ArrowLeft:
        updatePlayerPositionAndDirection(
          newState,
          proposedState,
          Direction.Left,
          -TILE_SIZE,
          0,
        );
        break;
      case Key.ArrowRight:
        updatePlayerPositionAndDirection(
          newState,
          proposedState,
          Direction.Right,
          TILE_SIZE,
          0,
        );
        break;
      case Key.Control:
        newState.action = PlayerAction.Attack;
        handleAttack(newState);
        break;
    }

    await delay((DEFAULT_PLAYER_SPEED * BOOST_MULTIPLIER) / player.speed);

    const collision = hasCollision(proposedState);
    const warp = hasWarp(proposedState);

    if (!collision) {
      newState.position = proposedState.position;
      if (warp) {
        newState.mapId = warp.to;
        newState.position = warp.position;
      }
    }

    updatePlayerMap(player.id, newState);
  }

  isActing = false;
};

const updatePlayerPositionAndDirection = (
  newState: Player,
  proposedState: Player,
  direction: Direction,
  dx: number,
  dy: number,
) => {
  newState.direction = direction;
  newState.action = PlayerAction.Walk;
  proposedState.position.x += dx;
  proposedState.position.y += dy;
};

const updatePlayerMap = (playerId: string, newState: Player) => {
  removePlayerFromMap(playerId);
  updatePlayer(newState);
  addPlayerOnMap(newState.id);
};

export const handleKeyRelease = (username: string, key: Key) => {
  const player = getPlayerByName(username);
  if (player) {
    const newState = { ...player };
    if (key === Key.Control) newState.action = PlayerAction.Idle;
    if (key === Key.Shift) newState.speed = DEFAULT_PLAYER_SPEED;
    if (
      [Key.ArrowDown, Key.ArrowLeft, Key.ArrowRight, Key.ArrowUp].includes(key)
    ) {
      newState.action = PlayerAction.Idle;
    }
    updatePlayer(newState);
  }
};

export const mapSave = (mapId: string, tiles: Tile[][]) => {
  const newMap = insertEnemies(mapId, tiles);
  updateMapById(newMap as MapState);
};

export const changeSprite = (spriteId: number, username: string) => {
  const newPlayer: Player = {
    ...getPlayerByName(username)!,
    sprite: spriteId,
  };
  handlePlayerUpdate(newPlayer);
  broadcast();
};

export const getGameState = () => getGameStateDb();

export const getPlayerByName = (username: string) =>
  Object.values(getPlayers()).find((player) => player.name === username);

export const login = (username: string) =>
  getPlayerByName(username) || createPlayer(username);

export const handlePlayerUpdate = (player: Player): void => {
  handlePlayerUpdates(player);
};

const isInAttackRange = (attacker: Player, target: Character): boolean => {
  const distanceX = Math.abs(attacker.position.x - target.position.x);
  const distanceY = Math.abs(attacker.position.y - target.position.y);

  return distanceX <= attacker.attackRange && distanceY <= attacker.attackRange;
};

const isFacingTarget = (attacker: Player, target: Character): boolean => {
  switch (attacker.direction) {
    case Direction.Up:
      return target.position.y < attacker.position.y;
    case Direction.Down:
      return target.position.y > attacker.position.y;
    case Direction.Left:
      return target.position.x < attacker.position.x;
    case Direction.Right:
      return target.position.x > attacker.position.x;
    default:
      return false;
  }
};

const findAttackTarget = (
  attacker: Player,
  map: MapState,
): Character | undefined => {
  if (map.type === 'pvp') {
    const opponentPlayers = Object.values(map.players).filter(
      (player) =>
        player.id !== attacker.id &&
        player.health > 0 &&
        isInAttackRange(attacker, player) &&
        isFacingTarget(attacker, player),
    );

    if (opponentPlayers.length > 0) {
      return opponentPlayers[0];
    }
  }

  const npcTargets = Object.values(map.enemies).filter(
    (enemy) =>
      enemy.health > 0 &&
      isInAttackRange(attacker, enemy) &&
      isFacingTarget(attacker, enemy),
  );

  return npcTargets[0];
};

export const handleAttack = (attacker: Player): void => {
  if (!attacker) return;

  const map = getMap(attacker.mapId);
  if (!map) return;

  const attackTarget = findAttackTarget(attacker, map);

  if (!attackTarget) return;

  attackTarget.health -= attacker.attack;

  if (attackTarget.health <= 0) {
    attackTarget.health = 0;

    if (isPlayer(attackTarget)) {
      respawnPlayer(attackTarget);
      updatePlayer(attackTarget);
    } else if (isEnemy(attackTarget)) {
      attacker.experience += attackTarget.experienceValue;
      levelUpPlayer(attacker);
      updatePlayer(attacker);
      respawnEnemy(attacker.mapId, attackTarget);
    }
  }
};

export const addPlayerOnMap = (playerId: string) => {
  const player = getPlayer(playerId);
  const map = player && getMap(player.mapId);
  if (!map) return;
  map.players[playerId] = player;
  return updateMap(map);
};

export const removePlayerFromMap = (playerId: string) => {
  const player = getPlayer(playerId);
  const map = player && getMap(player.mapId);
  if (!map) return;
  delete map.players[playerId];
  return updateMap(map);
};

export const disconnectPlayer = (username?: string) => {
  const player = username && getPlayerByName(username);
  const map = player && getMap(player.mapId);
  if (!map) return;
  delete map.players[player.id];
  updateMap(map);
};

export function handleChatAction(action: ClientChatAction) {
  const message: ClientChatAction = {
    type: 'chat',
    username: action.username,
    message: action.message,
    scope: action.scope,
  };

  if (action.scope === 'global') {
    broadcastChat(message);
  } else {
    broadcastLocalChat(action.username, message);
  }
}
