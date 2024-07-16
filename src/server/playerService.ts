import {
  SPRITE_WIDTH,
  SPRITE_HEIGHT,
  DEFAULT_PLAYER_SPEED,
  FIRST_GAME_MAP_ID,
  RESPAWN_POSITION,
  TILE_SIZE,
} from '../shared/constants';
import { PlayerAction, Direction, Player, Access } from '../shared/types';
import { addPlayer, getPlayer, updatePlayer } from './database';

export const createPlayer = (username: string): Player => {
  const newPlayer: Player = {
    id: Math.random().toString(36).substring(2, 9),
    name: username,
    position: RESPAWN_POSITION,
    width: SPRITE_WIDTH,
    height: SPRITE_HEIGHT,
    speed: DEFAULT_PLAYER_SPEED,
    attack: 80,
    level: 1,
    experience: 0,
    experienceToNextLevel: 100,
    attackRange: TILE_SIZE,
    mapId: FIRST_GAME_MAP_ID,
    sprite: 0,
    health: 100,
    access: Access.USER,
    direction: Direction.Down,
    action: PlayerAction.Idle,
  };

  addPlayer(newPlayer);
  return newPlayer;
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
  player.health = 100;
  player.mapId = FIRST_GAME_MAP_ID;
  player.position = RESPAWN_POSITION;
};
