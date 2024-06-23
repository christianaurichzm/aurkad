import { GameMap } from '../../shared/types';
import { getPlayer, setPlayer } from './player';

let gameMap: GameMap;

export const updateGameState = (map: GameMap, playerId?: string | null) => {
  gameMap = map;
  if (playerId) {
    setPlayer(map?.players[playerId]);
  }
};

export const getGameState = () => {
  return gameMap;
};
