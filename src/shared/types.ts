// shared/types.ts
export enum Key {
  ArrowUp = 'ArrowUp',
  ArrowDown = 'ArrowDown',
  ArrowLeft = 'ArrowLeft',
  ArrowRight = 'ArrowRight',
  Shift = 'Shift',
  Control = 'Control',
  z = 'z',
  i = 'i',
  e = 'e',
}

export enum Direction {
  Down = 0,
  Left = 1,
  Right = 2,
  Up = 3,
}

export enum PlayerAction {
  Idle = 'Idle',
  Walk = 'Walk',
  Attack = 'Attack',
}

export enum Protocol {
  HTTP,
  WS,
}

export enum Access {
  USER = 0,
  ADMIN = 1,
}

export const playerActionRecord: Record<PlayerAction, number> = {
  [PlayerAction.Idle]: 0,
  [PlayerAction.Walk]: 2,
  [PlayerAction.Attack]: 2,
};

export const playerNameColorRecord: Record<Access, string> = {
  [Access.USER]: 'yellow',
  [Access.ADMIN]: 'black',
};

export const keyRecord: Partial<Record<Key, Protocol>> = {
  ArrowUp: Protocol.WS,
  ArrowDown: Protocol.WS,
  ArrowLeft: Protocol.WS,
  ArrowRight: Protocol.WS,
  Shift: Protocol.WS,
  Control: Protocol.WS,
  e: Protocol.WS,
  z: Protocol.HTTP,
};

export enum ServerActionType {
  UpdateNpcPositions = 'UpdateNpcPositions',
}

export interface KeyboardAction {
  key: Key;
  type: 'press' | 'release';
}

export type ClientActionType = 'keyboard' | 'item' | 'chat';

export interface ClientAction {
  username: string;
  type: ClientActionType;
}

export interface ClientKeyboardAction extends ClientAction {
  type: 'keyboard';
  keyboardAction: KeyboardAction;
}

export interface ClientItemAction extends ClientAction {
  type: 'item';
  item: number;
  action: 'use' | 'drop';
}

export interface ClientChatAction extends ChatBase, ClientAction {
  type: 'chat';
}

export interface ServerChatAction extends ChatBase {
  subtype?: ChatSubtype;
  mapId?: string;
}

export interface ChatMessagePayload extends ChatBase {
  username?: string;
  subtype?: ChatSubtype;
}

interface ChatBase {
  type: 'chat';
  scope: ChatScope;
  message: string;
}

export type ChatScope = 'local' | 'global';

export type ChatSubtype = 'death';

export interface ServerAction {
  action: ServerActionType;
}

export type ActionQueueItem =
  | ClientKeyboardAction
  | ClientItemAction
  | ClientChatAction
  | ServerAction;

export type ActionQueue = Array<ActionQueueItem>;

export interface Character {
  id: string;
  position: Position;
  width: number;
  height: number;
  sprite: number;
  health: number;
  attack: number;
  direction: Direction;
  action: PlayerAction;
  attackRange: number;
  mapId: MapState['id'];
}

export interface Position {
  x: number;
  y: number;
}

type NumericKeys<T> = {
  [K in keyof T]: T[K] extends number ? K : never;
}[keyof T];

export type EffectType = 'add' | 'multiply';

export interface Effect {
  attribute: Exclude<NumericKeys<Character>, 'width' | 'height'>;
  type: EffectType;
  value: number;
}

export interface Item {
  id: number;
  name: string;
  description: string;
  sprite: number;
  type: 'weapon' | 'helmet' | 'chestplate' | 'gloves' | 'boots' | 'consumable';
  effects?: Effect[];
}

export interface Inventory {
  items: InventoryItem[];
  maxCapacity: number;
}

export interface InventoryItem extends Item {
  quantity: number;
}

export interface EquippedItems {
  weapon?: Item;
  helmet?: Item;
  chestplate?: Item;
  gloves?: Item;
  boots?: Item;
}

export interface Player extends Character {
  name: string;
  level: number;
  speed: number;
  experience: number;
  experienceToNextLevel: number;
  inventory: Inventory;
  equipped: EquippedItems;
  access: Access;
}

export type PlayersMap = { [key: string]: Player };

export type NpcsMap = { [key: string]: Npc };

export type ItemsMap = { [key: number]: Item };

export type NpcBehavior = 'aggressive' | 'hostile' | 'neutral';

export interface Npc extends Character {
  behavior: NpcBehavior;
  experienceValue?: number;
  itemsToDrop?: NpcItemDrop[];
}

export interface GameState {
  maps: Record<string, MapState>;
}

export interface Warp {
  to: MapState['id'];
  position: Position;
}

export interface Tile {
  tileIndex: number;
  blocked?: boolean;
  warp?: Warp;
  npcSpawn?: Npc['id'];
  item?: Item['id'];
}

export interface MapState {
  id: string;
  name: string;
  type: 'pvp' | 'normal';
  players: Record<string, Player>;
  npcs: Record<string, Npc>;
  tiles: Tile[][];
  droppedItems: DroppedItem[];
}

export interface NpcItemDrop {
  itemId: Item['id'];
  chance: number;
}

export interface DroppedItem {
  itemId: Item['id'];
  position: Position;
  sprite: number;
}

export interface HttpRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: any;
}

export type TileEditMode = 'blocking' | 'warping' | 'npc' | 'item';
