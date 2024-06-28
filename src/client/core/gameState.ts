import { MapState, Player } from '../../shared/types';

let gameMap: MapState;

let _player: Player;

export const setPlayer = (player: Player) => {
  _player = player;
};

export const getPlayer = (): Player => {
  return _player;
};

export const updateGameState = (gameState: MapState) => {
  gameMap = gameState;
};

export const getGameState = () => {
  return gameMap;
};
