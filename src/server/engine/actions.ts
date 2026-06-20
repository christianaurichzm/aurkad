import type { ChatScope, KeyboardAction } from '../../shared/types.js';

export type ClientActionType = 'keyboard' | 'item' | 'chat';

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
}

export interface ClientChatAction extends ClientActionBase {
  type: 'chat';
  scope: ChatScope;
  message: string;
}

export enum ServerActionType {
  UpdateNpcPositions = 'UpdateNpcPositions',
  RegeneratePlayersHP = 'RegeneratePlayersHP',
}

export interface ServerAction {
  action: ServerActionType;
}

export type ActionQueueItem =
  | ClientKeyboardAction
  | ClientItemAction
  | ClientChatAction
  | ServerAction;
