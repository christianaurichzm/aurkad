import { GameState, MessageType, Player } from '../shared/types';
import { getEnemies, getPlayers } from './database';
import { handleAttack as attackService } from './enemyService';
import { handlePlayerUpdates } from './playerService';

export const handlePlayerUpdate = (player: Player): void => {
    handlePlayerUpdates(player);
};

export const handleAttack = (playerId: string): void => {
  attackService(playerId);
};

export const getGameState = (): GameState => ({
  type: MessageType.GAME_STATE,
  players: getPlayers(),
  enemies: getEnemies()
});
