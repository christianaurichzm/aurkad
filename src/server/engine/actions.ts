import type { ChatScope, KeyboardAction } from '../../shared/types.js';

export type ClientActionType =
  'keyboard' | 'item' | 'chat' | 'custom' | 'language' | 'moveTo';

export interface ClientActionBase {
  username: string;
  type: ClientActionType;
}

export interface ClientKeyboardAction extends ClientActionBase {
  type: 'keyboard';
  keyboardAction: KeyboardAction;
  seq?: number;
}

export interface ClientItemAction extends ClientActionBase {
  type: 'item';
  item: number;
  action: 'use' | 'drop';
  quantity?: number;
}

export interface ClientChatAction extends ClientActionBase {
  type: 'chat';
  scope: ChatScope;
  message: string;
}

export interface ClientCustomAction extends ClientActionBase {
  type: 'custom';
  channel: string;
  payload?: unknown;
}

export interface ClientLanguageAction extends ClientActionBase {
  type: 'language';
  language: string;
}

export interface ClientMoveToAction extends ClientActionBase {
  type: 'moveTo';
  col: number;
  row: number;
}

export enum ServerActionType {
  UpdateNpcPositions = 'UpdateNpcPositions',
  RegeneratePlayersHP = 'RegeneratePlayersHP',
}

export interface ServerAction {
  action: ServerActionType;
}

/** Everything a client can ask for: the six the tick drains and records. */
export type ClientAction =
  | ClientKeyboardAction
  | ClientItemAction
  | ClientChatAction
  | ClientCustomAction
  | ClientLanguageAction
  | ClientMoveToAction;

export type ActionQueueItem = ClientAction | ServerAction;
