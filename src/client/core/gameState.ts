import { MapState, Player } from '../../shared/types';

let gameMap: MapState;

let _player: Player;

export const setPlayer = (player: Player) => {
  _player = player;
};

export const getPlayer = (): Player => {
  return _player;
};

export const updateGameState = (map: MapState, playerId?: string | null) => {
  gameMap = map;
  if (playerId) {
    setPlayer(map?.players[playerId]);
  }
};

export const getGameState = () => {
  return gameMap;
};
