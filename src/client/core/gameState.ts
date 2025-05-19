import { MapStateClient, Player } from '../../shared/types';

let gameMap: MapStateClient;

let player: Player;

export const setPlayer = (playerState: Player) => {
  player = playerState;
};

export const getPlayer = (): Player => {
  return player;
};

export const updateGameState = (gameState: MapStateClient) => {
  gameMap = gameState;
};

export const getGameState = () => {
  return gameMap;
};
