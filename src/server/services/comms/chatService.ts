import { ServerChatAction, ChatMessagePayload } from '../../../shared/types.js';
import type { ClientChatAction } from '../../engine/actions.js';
import { logger } from '../../logger.js';
import { emitGameEvent } from '../../engine/eventBus.js';
import { emit } from '../../engine/hooks.js';
import { handleChatCommand } from '../../engine/commands.js';
import { isMuted } from '../serverState.js';
import { playersWsMap } from '../../net/connections.js';
import { WebSocket } from 'ws';
import { getPlayerByName } from '../player/playerService.js';
import { registerStrings, translate } from '../../engine/i18n.js';
import { publishToInstances } from '../../persistence/instanceBus.js';
import { getTick, msToTicks } from '../../sim/clock.js';
import { scheduleAfter } from '../../sim/scheduler.js';

// The only lines this service says on its own; the rest of what passes
// through is what a player or an operator wrote.
registerStrings({
  pt: {
    'You are muted and cannot send messages.':
      'Você está silenciado e não pode enviar mensagens.',
    'You are sending messages too fast.':
      'Você está enviando mensagens rápido demais.',
  },
  es: {
    'You are muted and cannot send messages.':
      'Estás silenciado y no puedes enviar mensajes.',
    'You are sending messages too fast.':
      'Estás enviando mensajes demasiado rápido.',
  },
});

// A few lines at once, then one a second. The socket's own limit is far
// above this, and a global line goes to every player on every instance.
const CHAT_BURST = 5;
const CHAT_INTERVAL_MS = 1000;

/** username -> the tick by which the full burst is back. */
const chatAllowance = new Map<string, number>();

function tryConsumeChatAllowance(username: string, tick: number): boolean {
  const interval = msToTicks(CHAT_INTERVAL_MS);
  const whole = Math.max(chatAllowance.get(username) ?? tick, tick);
  if (whole - tick > (CHAT_BURST - 1) * interval) return false;
  chatAllowance.set(username, whole + interval);
  return true;
}

/**
 * On departure. An allowance still being paid off outlives the session, or
 * leaving and coming straight back would hand a flooder a fresh burst.
 */
export function forgetChatAllowance(username: string): void {
  const left = (chatAllowance.get(username) ?? 0) - getTick();
  if (left > 0)
    scheduleAfter(left, () => forgetChatAllowance(username), 'chat');
  else chatAllowance.delete(username);
}

/** Players holding a chat allowance, published as a metric. */
export function chatAllowanceCount(): number {
  return chatAllowance.size;
}

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

function sendNotice(username: string, text: string) {
  const ws = playersWsMap.get(username);
  if (ws?.readyState === WebSocket.OPEN) {
    const notice: ChatMessagePayload = {
      type: 'chat',
      scope: 'player',
      message: translate(getPlayerByName(username), text),
    };
    ws.send(JSON.stringify(notice));
  }
}

export function handleChatAction(action: ClientChatAction | ServerChatAction) {
  if (isClientChatAction(action) && isMuted(action.username)) {
    sendNotice(action.username, 'You are muted and cannot send messages.');
    return;
  }

  // A "/command" from a player is consumed here (handled + suppressed), so it
  // never broadcasts as chat.
  if (isClientChatAction(action)) {
    const sender = getPlayerByName(action.username);
    if (sender && handleChatCommand(sender, action.message)) return;
  }

  // After the command: a reply goes to the one who typed it, and an operator
  // working through a run of commands is not flooding anyone.
  if (
    isClientChatAction(action) &&
    !tryConsumeChatAllowance(action.username, getTick())
  ) {
    sendNotice(action.username, 'You are sending messages too fast.');
    return;
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
