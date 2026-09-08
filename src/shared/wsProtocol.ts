import type {
  ChatMessagePayload,
  ChatScope,
  DroppedItem,
  KeyboardAction,
  MapChunkPayload,
  MapDynamicClient,
  MapMetaClient,
  PlayerCold,
  PlayerHot,
  PlayerPublic,
  RuntimeNpc,
} from './types.js';

// Wire format version. Bump on any breaking change to the server->client
// game-state messages: the client compares it and reloads instead of
// applying a payload it cannot read, where a stale tab after a deploy
// would corrupt its state silently.
export const PROTOCOL_VERSION = 2;

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

// The language this client reads, so a command reply and a script notice come
// back in it. Sent on connect and on every switch; the server keeps it on the
// session, never on the account.
export interface WsClientLanguageMessage {
  type: 'language';
  language: string;
}

export type WsClientMessage =
  | WsClientKeyboardMessage
  | WsClientItemMessage
  | WsClientChatMessage
  | WsClientCustomMessage
  | WsClientLanguageMessage;

// Client-side shape of the dynamic world: what the client assembles and
// renders from the wire format (see WorldUpdatePayload).
export interface FullGameStatePayload {
  map: MapDynamicClient;
  player: PlayerHot;
}

export interface WsServerMapMetaMessage {
  v: number;
  type: 'mapMeta';
  payload: MapMetaClient;
}

export interface WsServerMapChunkMessage {
  v: number;
  type: 'mapChunk';
  payload: MapChunkPayload;
}

export type PlayerStatsPayload = PlayerCold;

export interface WsServerPlayerStatsMessage {
  v: number;
  type: 'playerStats';
  payload: PlayerStatsPayload;
}

/**
 * Per-tick world update.
 *
 * `entities` carries only what changed, keyed by entity id. The server
 * guarantees an entity ENTERING the viewport is sent complete, so the client
 * can simply merge when it already knows the id and insert when it does not -
 * no full-vs-partial marker on the wire. `kind` (present on both PlayerPublic
 * and RuntimeNpc) routes an incoming entity to the players or npcs bucket.
 *
 * `droppedItems` is sent whole, and only when the viewer's filtered list
 * changed: drops have no stable id to diff against, and the list is small.
 */
export interface WorldUpdatePayload {
  entities: Record<string, Partial<PlayerPublic> | Partial<RuntimeNpc>>;
  leave: string[];
  self: PlayerHot;
  droppedItems?: DroppedItem[];
}

export interface WsServerWorldUpdateMessage {
  v: number;
  type: 'worldUpdate';
  payload: WorldUpdatePayload;
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

export interface WsServerRedirectMessage {
  type: 'redirect';
  url: string;
  /**
   * The trace the hand-off belongs to, in W3C `traceparent` form. The client
   * puts it on the query string of its next socket, the only way the
   * receiving instance can tell the connection ends a warp begun elsewhere.
   * Optional and additive, as a client ignoring it reconnects the same.
   */
  traceparent?: string;
}

export type WsServerMessage =
  | WsServerChatMessage
  | WsServerKickMessage
  | WsServerOpenShopMessage
  | WsServerCustomMessage
  | WsServerRedirectMessage
  | WsServerMapMetaMessage
  | WsServerMapChunkMessage
  | WsServerPlayerStatsMessage
  | WsServerWorldUpdateMessage;
