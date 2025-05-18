import {
  RESPAWN_POSITION,
  SPRITE_WIDTH,
  SPRITE_HEIGHT,
  DEFAULT_PLAYER_SPEED,
  TILE_SIZE,
  FIRST_GAME_MAP_ID,
} from '../../shared/constants';
import {
  Player,
  Access,
  Direction,
  PlayerAction,
  Character,
} from '../../shared/types';
import { addPlayer, getPlayer, updatePlayer } from '../database';
import { addPlayerOnMap, removePlayerFromMap } from './mapService';

export const createPlayer = (username: string): Player => {
  const newPlayer: Player = {
    id: Math.random().toString(36).substring(2, 9),
    name: username,
    position: RESPAWN_POSITION,
    width: SPRITE_WIDTH,
    height: SPRITE_HEIGHT,
    speed: DEFAULT_PLAYER_SPEED,
    attack: 100,
    level: 1,
    experience: 0,
    experienceToNextLevel: 100,
    attackRange: TILE_SIZE,
    mapId: FIRST_GAME_MAP_ID,
    sprite: 0,
    maxHealth: 100,
    health: 100,
    inventory: {
      items: [],
      maxCapacity: 10,
    },
    equipped: {},
    access: Access.USER,
    direction: Direction.Down,
    action: PlayerAction.Idle,
  };

  addPlayer(newPlayer);
  return newPlayer;
};

export const isPlayer = (char: Character): char is Player => {
  return (char as Player).inventory !== undefined;
};

export const levelUpPlayer = (player: Player): void => {
  while (player.experience >= player.experienceToNextLevel) {
    player.experience -= player.experienceToNextLevel;
    player.level++;
    player.experienceToNextLevel = Math.floor(
      100 * Math.pow(1.5, player.level - 1),
    );
  }
};

export const handlePlayerUpdates = (player: Player): void => {
  const existingPlayer = getPlayer(player.id);
  if (existingPlayer) {
    updatePlayer({ ...existingPlayer, ...player });
  }
};

export const respawnPlayer = (player: Player): void => {
  player.health = player.maxHealth;
  removePlayerFromMap(player.id);
  player.mapId = FIRST_GAME_MAP_ID;
  player.position = RESPAWN_POSITION;
  addPlayerOnMap(player.id);
};
