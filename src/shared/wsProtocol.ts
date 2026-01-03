import type {
  ChatMessagePayload,
  ChatScope,
  KeyboardAction,
  MapStateClient,
  Player,
} from './types.js';

export interface WsClientKeyboardMessage {
  type: 'keyboard';
  keyboardAction: KeyboardAction;
}

export interface WsClientItemMessage {
  type: 'item';
  item: number;
  action: 'use' | 'drop';
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
  map: MapStateClient;
  player: Player;
}

export interface WsServerFullGameStateMessage {
  type: 'fullGameState';
  payload: FullGameStatePayload;
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
  | WsServerFullGameStateMessage
  | WsServerGameStateDeltaMessage;
