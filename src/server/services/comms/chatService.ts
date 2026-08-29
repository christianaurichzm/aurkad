import { ServerChatAction, ChatMessagePayload } from '../../../shared/types.js';
import type { ClientChatAction } from '../../engine/actions.js';
import { logger } from '../../logger.js';
import { emitGameEvent } from '../../engine/eventBus.js';
import { emit } from '../../engine/hooks.js';
import { handleChatCommand } from '../../engine/commands.js';
import { isMuted } from '../world/serverState.js';
import { playersWsMap } from '../../net/connections.js';
import { WebSocket } from 'ws';
import { getPlayerByName } from '../player/playerService.js';
import { registerStrings, translate } from '../../engine/i18n.js';
import { publishToInstances } from '../../persistence/instanceBus.js';

// The only line this service says on its own; the rest of what passes through
// is what a player or an operator wrote.
registerStrings({
  pt: {
    'You are muted and cannot send messages.':
      'Você está silenciado e não pode enviar mensagens.',
  },
});

export type ChatLogEntry = {
  ts: number;
  username?: string;
  scope: ChatMessagePayload['scope'];
  message: string;
};

const CHAT_LOG_LIMIT = 200;
const chatLog: ChatLogEntry[] = [];

export function getChatLog(n = 20): ChatLogEntry[] {
  return chatLog.slice(-n);
}

function isClientChatAction(
  action: ClientChatAction | ServerChatAction,
): action is ClientChatAction {
  return 'username' in action;
}

function isServerChatAction(
  action: ClientChatAction | ServerChatAction,
): action is ServerChatAction {
  return !('username' in action);
}

function sendMutedNotice(username: string) {
  const ws = playersWsMap.get(username);
  if (ws?.readyState === WebSocket.OPEN) {
    const notice: ChatMessagePayload = {
      type: 'chat',
      scope: 'player',
      message: translate(
        getPlayerByName(username),
        'You are muted and cannot send messages.',
      ),
    };
    ws.send(JSON.stringify(notice));
  }
}

export function handleChatAction(action: ClientChatAction | ServerChatAction) {
  if (isClientChatAction(action) && isMuted(action.username)) {
    sendMutedNotice(action.username);
    return;
  }

  // A "/command" from a player is consumed here (handled + suppressed), so it
  // never broadcasts as chat.
  if (isClientChatAction(action)) {
    const sender = getPlayerByName(action.username);
    if (sender && handleChatCommand(sender, action.message)) return;
  }

  const payload: ChatMessagePayload = {
    type: 'chat',
    scope: action.scope,
    message: action.message,
    ...(isServerChatAction(action) && action.subtype
      ? { subtype: action.subtype }
      : {}),
    ...(isClientChatAction(action) ? { username: action.username } : {}),
  };

  const entry: ChatLogEntry = {
    ts: Date.now(),
    username: payload.username,
    scope: payload.scope,
    message: payload.message,
  };
  chatLog.push(entry);
  if (chatLog.length > CHAT_LOG_LIMIT) chatLog.shift();

  if (isClientChatAction(action)) {
    const player = getPlayerByName(action.username);
    if (player)
      emit('chatMessage', {
        player,
        scope: action.scope,
        message: action.message,
      });
  }

  logger.info('chat', {
    scope: entry.scope,
    username: entry.username,
    message: entry.message,
  });

  if (payload.scope === 'global') {
    emitGameEvent({ type: 'chatGlobal', payload });
    // Global is the only scope that leaves this process: a map lives on one
    // instance, so map chat already reaches everyone who could hear it.
    publishToInstances('chat', payload);
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

/**
 * A global line from another instance, arriving. The mute, the `/command`
 * and the sender's `chatMessage` hook already ran where it was typed; this
 * is this instance's copy of the room: its chat log, its players, and the
 * scripts watching from this side.
 */
export function receiveGlobalLine(payload: ChatMessagePayload): void {
  chatLog.push({
    ts: Date.now(),
    username: payload.username,
    scope: 'global',
    message: payload.message,
  });
  if (chatLog.length > CHAT_LOG_LIMIT) chatLog.shift();

  logger.info('chat', {
    scope: 'global',
    username: payload.username,
    message: payload.message,
  });

  emitGameEvent({ type: 'chatGlobal', payload });
}
