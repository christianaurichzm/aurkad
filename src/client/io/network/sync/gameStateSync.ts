import type {
  WsServerFullGameStateMessage,
  WsServerGameStateDeltaMessage,
  WsServerMapStaticMessage,
  WsServerPlayerStatsMessage,
} from '../../../../shared/wsProtocol';
import {
  getPlayer,
  getGameState,
  patchGameState,
  setFullGameState,
  setPlayerStats,
  setStaticMap,
} from '../../../core/gameState';
import { onServerPositionUpdate } from '../../../graphics/render';
import { useUIStore } from '../../../stores/uiStore';

type GameStateMessage =
  | WsServerMapStaticMessage
  | WsServerPlayerStatsMessage
  | WsServerFullGameStateMessage
  | WsServerGameStateDeltaMessage;

const gameStateQueue: Array<GameStateMessage> = [];

export function enqueueGameStateMessage(message: GameStateMessage) {
  gameStateQueue.push(message);
}

export function updateWebSocket(): void {
  while (gameStateQueue.length > 0) {
    const message = gameStateQueue.shift();

    if (!message?.payload) continue;

    const previousPlayer = structuredClone(getPlayer());

    if (message.type === 'mapStatic') {
      setStaticMap(message.payload);
    } else if (message.type === 'playerStats') {
      setPlayerStats(message.payload);
    } else if (message.type === 'fullGameState') {
      setFullGameState(message.payload);
    } else if (message.type === 'gameStateDelta') {
      patchGameState(message.payload);
    }

    const currentPlayer = getPlayer();
    const currentMap = getGameState();

    if (currentMap) {
      useUIStore.getState().setCurrentMap(currentMap);
    }

    if (previousPlayer && currentPlayer) {
      const moved =
        previousPlayer.position.x !== currentPlayer.position.x ||
        previousPlayer.position.y !== currentPlayer.position.y;

      if (moved) {
        onServerPositionUpdate(
          currentPlayer.id,
          previousPlayer.position,
          currentPlayer.position,
        );
      }
    }
  }
}
