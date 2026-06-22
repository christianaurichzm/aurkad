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
