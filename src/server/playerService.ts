import { SPRITE_WIDTH, SPRITE_HEIGHT } from '../shared/constants';
import { PlayerAction, Direction, Player } from '../shared/types';
import { addPlayer, getPlayer, updatePlayer } from './database';
import { FIRST_GAME_MAP_ID } from './gameService';

export const DEFAULT_PLAYER_SPEED = 10;

export const createPlayer = (username: string): Player => {
  const newPlayer: Player = {
    id: Math.random().toString(36).substring(2, 9),
    name: username,
    position: {
      x: Math.random() * 750,
      y: Math.random() * 550,
    },
    width: SPRITE_WIDTH / 2,
    height: SPRITE_HEIGHT / 2,
    color: `#${Math.floor(Math.random() * 16777215).toString(16)}`,
    speed: DEFAULT_PLAYER_SPEED,
    attack: 80,
    level: 1,
    experience: 0,
    experienceToNextLevel: 100,
    attackRange: 50,
    mapId: FIRST_GAME_MAP_ID,
    sprite: 0,
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
