import { Enemy, PlayersMap } from '../../shared/types';
import { setPlayer, getPlayer } from './player';
import { render } from '../graphics/render';

let _players: PlayersMap = {};
let _enemies: Enemy[] = [];

export const updateGameState = (
  players: PlayersMap,
  enemies: Enemy[],
  playerId: string | null,
) => {
  _players = players;
  _enemies = enemies;
  if (playerId) {
    setPlayer(players[playerId]);
  }

  render(_players, _enemies);
};

export const getGameState = () => {
  return {
    player: getPlayer(),
    players: _players,
    enemies: _enemies,
  };
};
