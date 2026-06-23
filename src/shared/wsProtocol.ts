import type {
  ChatMessagePayload,
  ChatScope,
  KeyboardAction,
  MapChunkPayload,
  MapDynamicClient,
  MapMetaClient,
  PlayerCold,
  PlayerHot,
} from './types.js';

export interface WsClientKeyboardMessage {
  type: 'keyboard';
  keyboardAction: KeyboardAction;
  seq?: number;
}

export interface WsClientItemMessage {
  type: 'item';
  item: number;
  action: 'use' | 'drop';
  quantity?: number;
}

export interface WsClientChatMessage {
  type: 'chat';
  scope: ChatScope;
  message: string;
}

// Game-defined message from a script/module's client code to its server code.
// `channel` namespaces it; `payload` is opaque to the engine.
export interface WsClientCustomMessage {
  type: 'custom';
  channel: string;
  payload?: unknown;
}

export type WsClientMessage =
  | WsClientKeyboardMessage
  | WsClientItemMessage
  | WsClientChatMessage
  | WsClientCustomMessage;

export interface FullGameStatePayload {
  map: MapDynamicClient;
  player: PlayerHot;
}

export interface WsServerFullGameStateMessage {
  type: 'fullGameState';
  payload: FullGameStatePayload;
}

export interface WsServerMapMetaMessage {
  type: 'mapMeta';
  payload: MapMetaClient;
}

export interface WsServerMapChunkMessage {
  type: 'mapChunk';
  payload: MapChunkPayload;
}

export type PlayerStatsPayload = PlayerCold;

export interface WsServerPlayerStatsMessage {
  type: 'playerStats';
  payload: PlayerStatsPayload;
}

export type GameStateDeltaPayload = unknown;

export interface WsServerGameStateDeltaMessage {
  type: 'gameStateDelta';
  payload: GameStateDeltaPayload;
}

export type WsServerChatMessage = ChatMessagePayload;

export interface WsServerKickMessage {
  type: 'kick';
  message?: string;
}

export interface WsServerOpenShopMessage {
  type: 'openShop';
  shopId: string;
}

// Game-defined message from a script/module's server code to its client code.
export interface WsServerCustomMessage {
  type: 'custom';
  channel: string;
  payload?: unknown;
}

export type WsServerMessage =
  | WsServerChatMessage
  | WsServerKickMessage
  | WsServerOpenShopMessage
  | WsServerCustomMessage
  | WsServerMapMetaMessage
  | WsServerMapChunkMessage
  | WsServerPlayerStatsMessage
  | WsServerFullGameStateMessage
  | WsServerGameStateDeltaMessage;
