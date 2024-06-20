import { Player, Enemy } from '../../shared/types';
import { setPlayer, getPlayer } from './player';
import { render } from '../graphics/render';

let _players: { [key: string]: Player } = {};
let _enemies: Enemy[] = [];

export function updateGameState(
  players: { [key: string]: Player },
  enemies: Enemy[],
  playerId: string | null,
) {
  _players = players;
  _enemies = enemies;
  if (playerId) {
    setPlayer(players[playerId]);
  }

  render(_players, _enemies);
}

export function getGameState() {
  return {
    player: getPlayer(),
    players: _players,
    enemies: _enemies,
  };
}
