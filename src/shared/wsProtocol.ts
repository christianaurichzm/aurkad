import type {
  ChatMessagePayload,
  ChatScope,
  KeyboardAction,
  MapDynamicClient,
  MapStaticClient,
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

export type WsClientMessage =
  | WsClientKeyboardMessage
  | WsClientItemMessage
  | WsClientChatMessage;

export interface FullGameStatePayload {
  map: MapDynamicClient;
  player: PlayerHot;
}

export interface WsServerFullGameStateMessage {
  type: 'fullGameState';
  payload: FullGameStatePayload;
}

export type MapStaticPayload = MapStaticClient;

export interface WsServerMapStaticMessage {
  type: 'mapStatic';
  payload: MapStaticPayload;
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

export type WsServerMessage =
  | WsServerChatMessage
  | WsServerKickMessage
  | WsServerOpenShopMessage
  | WsServerMapStaticMessage
  | WsServerPlayerStatsMessage
  | WsServerFullGameStateMessage
  | WsServerGameStateDeltaMessage;
