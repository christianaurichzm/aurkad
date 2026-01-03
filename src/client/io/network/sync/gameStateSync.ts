import type {
  WsServerFullGameStateMessage,
  WsServerGameStateDeltaMessage,
} from '../../../../shared/wsProtocol';
import {
  getPlayer,
  getGameState,
  patchGameState,
  setFullGameState,
} from '../../../core/gameState';
import { onServerPositionUpdate } from '../../../graphics/render';
import { useUIStore } from '../../../stores/uiStore';

const gameStateQueue: Array<
  WsServerFullGameStateMessage | WsServerGameStateDeltaMessage
> = [];

export function enqueueGameStateMessage(
  message: WsServerFullGameStateMessage | WsServerGameStateDeltaMessage,
) {
  gameStateQueue.push(message);
}

export function updateWebSocket(): void {
  while (gameStateQueue.length > 0) {
    const message = gameStateQueue.shift();

    if (!message?.payload) continue;

    const previousPlayer = structuredClone(getPlayer());

    if (message.type === 'fullGameState') {
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
