import { MapState, Player } from '../../shared/types';

let gameMap: MapState;

let player: Player;

export const setPlayer = (playerState: Player) => {
  player = playerState;
};

export const getPlayer = (): Player => {
  return player;
};

export const updateGameState = (gameState: MapState) => {
  gameMap = gameState;
};

export const getGameState = () => {
  return gameMap;
};
