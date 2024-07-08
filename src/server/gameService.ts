import {
  BOOST_MULTIPLIER,
  DEFAULT_PLAYER_SPEED,
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
} from '../shared/types';
import {
  getGameStateDb,
  getMap,
  getPlayer,
  getPlayers,
  updateMap,
  updateMapById,
  updatePlayer,
} from './database';
import { respawnEnemy } from './enemyService';
import {
  createPlayer,
  handlePlayerUpdates,
  levelUpPlayer,
} from './playerService';
import { broadcast } from './wsServer';

const isColliding = (a: Character, b: Character): boolean => {
  return (
    a.position.x < b.position.x + b.width &&
    a.position.x + a.width > b.position.x &&
    a.position.y < b.position.y + b.height &&
    a.position.y + a.height > b.position.y
  );
};

const isTileBlocked = (map: MapState, x: number, y: number): boolean => {
  const row = Math.floor(y / TILE_SIZE);
  const col = Math.floor(x / TILE_SIZE);
  return map.tiles[row] && map.tiles[row][col] && map.tiles[row][col].blocked;
};

export const hasCollision = (character: Character) => {
  const map = getMap(character.mapId)!;
  const { players, enemies } = map;

  const characterCollision =
    Object.values(enemies).some(
      (otherEnemy) =>
        otherEnemy.id !== character.id && isColliding(character, otherEnemy),
    ) ||
    Object.values(players).some(
      (otherPlayer) =>
        otherPlayer.id !== character.id && isColliding(character, otherPlayer),
    );

  const tileCollision =
    isTileBlocked(map, character.position.x, character.position.y) ||
    isTileBlocked(
      map,
      character.position.x + character.width,
      character.position.y,
    ) ||
    isTileBlocked(
      map,
      character.position.x,
      character.position.y + character.height,
    ) ||
    isTileBlocked(
      map,
      character.position.x + character.width,
      character.position.y + character.height,
    );

  return characterCollision || tileCollision;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let isActing = false;

export const handleKeyPress = async (username: string, key: Key) => {
  if (isActing) return;
  isActing = true;

  const player = getPlayerByName(username);
  if (player) {
    const newState = { ...player };
    if (key === Key.Shift) {
      newState.speed **= BOOST_MULTIPLIER;
    }

    const proposedState = JSON.parse(JSON.stringify(newState));

    if (key === Key.ArrowUp) {
      newState.direction = Direction.Up;
      newState.action = PlayerAction.Walk;
      proposedState.position.y -= TILE_SIZE;
    } else if (key === Key.ArrowDown) {
      newState.direction = Direction.Down;
      newState.action = PlayerAction.Walk;
      proposedState.position.y += TILE_SIZE;
    } else if (key === Key.ArrowLeft) {
      newState.direction = Direction.Left;
      newState.action = PlayerAction.Walk;
      proposedState.position.x -= TILE_SIZE;
    } else if (key === Key.ArrowRight) {
      newState.direction = Direction.Right;
      newState.action = PlayerAction.Walk;
      proposedState.position.x += TILE_SIZE;
    }

    await delay(DEFAULT_PLAYER_SPEED ** BOOST_MULTIPLIER / player.speed);

    const collision = hasCollision(proposedState);

    if (!collision) {
      newState.position = proposedState.position;
    }

    if (key === Key.Control) {
      newState.action = PlayerAction.Attack;
      handleAttack(newState);
    }

    updatePlayer(newState);
  }

  isActing = false;
};

export function handleKeyRelease(username: string, key: Key) {
  const player = getPlayerByName(username);
  if (player) {
    const newState = { ...player };
    if (key === Key.Control) {
      newState.action = PlayerAction.Idle;
    }

    if (key === Key.Shift) {
      newState.speed = DEFAULT_PLAYER_SPEED;
    }
    if (
      [Key.ArrowDown, Key.ArrowLeft, Key.ArrowRight, Key.ArrowUp].includes(key)
    ) {
      newState.action = PlayerAction.Idle;
    }
    updatePlayer(newState);
  }
}

export function mapSave(mapId: string, tiles: Tile[][]) {
  updateMapById(mapId, tiles);
}

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

export const login = (username: string) => {
  return getPlayerByName(username) || createPlayer(username);
};

export const handlePlayerUpdate = (player: Player): void => {
  handlePlayerUpdates(player);
};

export const handleAttack = (player: Player): void => {
  if (!player) return;

  const map = getMap(player.mapId);
  const enemies = map?.enemies;
  if (enemies) {
    Object.values(enemies).forEach((enemy) => {
      const distanceX = Math.abs(player.position.x - enemy.position.x);
      const distanceY = Math.abs(player.position.y - enemy.position.y);

      const isWithinAttackRange =
        distanceX <= player.attackRange && distanceY <= player.attackRange;

      const isFacingEnemy =
        (player.direction === Direction.Up &&
          enemy.position.y < player.position.y) ||
        (player.direction === Direction.Down &&
          enemy.position.y > player.position.y) ||
        (player.direction === Direction.Left &&
          enemy.position.x < player.position.x) ||
        (player.direction === Direction.Right &&
          enemy.position.x > player.position.x);

      if (isWithinAttackRange && isFacingEnemy && enemy.health > 0) {
        enemy.health -= player.attack;

        if (enemy.health <= 0) {
          enemy.health = 0;
          player.experience += enemy.experienceValue;

          levelUpPlayer(player);
          respawnEnemy(enemy);
        }
      }
    });
  }
};

export const addPlayerOnMap = (playerId: string) => {
  const player = getPlayer(playerId);
  if (!player) return;
  const map = getMap(player.mapId);
  if (!map) return;
  map.players[playerId] = player;
  return updateMap(map);
};

export const disconnectPlayer = (username?: string) => {
  if (!username) return;
  const player = getPlayerByName(username);
  if (!player) return;
  const map = getMap(player.mapId);
  if (!map) return;
  delete map.players[player.id];
  updateMap(map);
};
