import { ServerChatAction, ChatMessagePayload } from '../../shared/types.js';
import type { ClientChatAction } from '../engine/actions.js';
import { logger } from '../logger.js';
import { emitGameEvent } from '../engine/eventBus.js';

function isClientChatAction(
  action: ClientChatAction | ServerChatAction,
): action is ClientChatAction {
  return 'username' in action;
}

function isServerChatAction(action: any): action is ServerChatAction {
  return !('username' in action);
}

export function handleChatAction(action: ClientChatAction | ServerChatAction) {
  const payload: ChatMessagePayload = {
    type: 'chat',
    scope: action.scope,
    message: action.message,
    ...(isServerChatAction(action) && action.subtype
      ? { subtype: action.subtype }
      : {}),
    ...(isClientChatAction(action) ? { username: action.username } : {}),
  };

  if (payload.scope === 'global') {
    emitGameEvent({ type: 'chatGlobal', payload });
  } else if (payload.scope === 'map') {
    if (isClientChatAction(action)) {
      emitGameEvent({
        type: 'chatMap',
        senderUsername: action.username,
        payload,
      });
    } else if (isServerChatAction(action) && action.mapId) {
      emitGameEvent({ type: 'chatMapId', mapId: action.mapId, payload });
    } else {
      logger.warn('Map server message missing mapId');
    }
  }
}
