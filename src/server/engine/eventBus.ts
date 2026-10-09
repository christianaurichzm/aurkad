import { config } from '../config.js';
import { logger } from '../logger.js';
import type { ChatMessagePayload } from '../../shared/types.js';

export type GameEvent =
  | {
      type: 'openShop';
      username: string;
      shopId: string;
    }
  | {
      type: 'chatGlobal';
      payload: ChatMessagePayload;
    }
  | {
      type: 'chatMap';
      senderUsername: string;
      payload: ChatMessagePayload;
    }
  | {
      type: 'chatMapId';
      mapId: string;
      payload: ChatMessagePayload;
    }
  | {
      type: 'chatPlayer';
      username: string;
      payload: ChatMessagePayload;
    }
  | {
      type: 'customPlayer';
      username: string;
      channel: string;
      payload: unknown;
    }
  | {
      type: 'customMap';
      mapId: string;
      channel: string;
      payload: unknown;
    }
  | {
      type: 'customAll';
      channel: string;
      payload: unknown;
    };

const queue: GameEvent[] = [];
let droppedEvents = 0;
let lastDropLogTime = 0;

export function emitGameEvent(event: GameEvent) {
  const maxSize = config.limits.eventQueueMaxSize;
  if (maxSize > 0 && queue.length >= maxSize) {
    queue.shift(); // drop oldest
    droppedEvents++;

    const now = Date.now();
    if (now - lastDropLogTime > 5000) {
      logger.warn('[engine] event queue full; dropping oldest', {
        dropped: droppedEvents,
        max: maxSize,
      });
      lastDropLogTime = now;
    }
  }

  queue.push(event);
}

export function drainGameEvents(): GameEvent[] {
  if (queue.length === 0) return [];
  return queue.splice(0, queue.length);
}
