import { GameMap } from '../../shared/types';
import { getPlayer, setPlayer } from './player';

const maps: { [key: string]: GameMap } = {};

export const updateGameState = (map: GameMap, playerId?: string | null) => {
  maps[map?.id] = map;
  if (playerId) {
    setPlayer(map?.players[playerId]);
  }
};

export const getGameState = () => {
  const player = getPlayer();
  if (player) {
    return maps[player.mapId];
  }
};
