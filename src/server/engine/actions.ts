import type { WsClientMessage } from '../../shared/wsProtocol.js';

/** Everything a client can ask for: the six the tick drains and records. */
export type ClientAction = WsClientMessage & { username: string };

type ActionOf<T extends ClientAction['type']> = Extract<
  ClientAction,
  { type: T }
>;

export type ClientKeyboardAction = ActionOf<'keyboard'>;
export type ClientItemAction = ActionOf<'item'>;
export type ClientChatAction = ActionOf<'chat'>;
export type ClientCustomAction = ActionOf<'custom'>;
export type ClientMoveToAction = ActionOf<'moveTo'>;
