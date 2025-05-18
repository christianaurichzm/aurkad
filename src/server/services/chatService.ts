import {
  ClientChatAction,
  ServerChatAction,
  ChatMessagePayload,
} from '../../shared/types';
import { broadcastChat, broadcastMapChat, broadcastToMap } from '../wsServer';

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
    broadcastChat(payload);
  } else if (payload.scope === 'map') {
    if (isClientChatAction(action)) {
      broadcastMapChat(action.username, payload);
    } else if (isServerChatAction(action) && action.mapId) {
      broadcastToMap(action.mapId, payload);
    } else {
      console.warn('Map server message missing mapId.');
    }
  }
}
