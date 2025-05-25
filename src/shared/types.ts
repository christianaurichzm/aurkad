import { EQUIPMENT_SLOTS } from './constants';

export enum Key {
  ArrowUp = 'ArrowUp',
  ArrowDown = 'ArrowDown',
  ArrowLeft = 'ArrowLeft',
  ArrowRight = 'ArrowRight',
  Shift = 'Shift',
  Control = 'Control',
  c = 'c',
  x = 'x',
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

export enum CharacterAction {
  Idle = 'Idle',
  Walk = 'Walk',
  Run = 'Run',
  Attack = 'Attack',
}

export enum Protocol {
  HTTP,
  WS,
}

export enum Access {
  USER = 0,
  MOD = 1,
  ADMIN = 2,
}

export enum ServerActionType {
  UpdateNpcPositions = 'UpdateNpcPositions',
  RegeneratePlayersHP = 'RegeneratePlayersHP',
}

export interface Position {
  x: number;
  y: number;
}

export type EffectType = 'add' | 'multiply';

export type ModifiablePlayerAttribute =
  | 'health'
  | 'maxHealth'
  | 'attack'
  | 'speed'
  | 'attackRange'
  | 'experience'
  | 'experienceToNextLevel'
  | 'level';

export interface Effect {
  attribute: ModifiablePlayerAttribute;
  type: EffectType;
  value: number;
}

export type BanEntry = { until?: number; reason?: string };

export type ItemType =
  | (typeof EQUIPMENT_SLOTS)[number]
  | 'consumable'
  | 'money';

export interface Item {
  id: number;
  name: string;
  description: string;
  sprite: number;
  type: ItemType;
  effects?: Effect[];
}

export interface Inventory {
  items: InventoryItem[];
  maxCapacity: number;
}

type InventoryItem = {
  item: Item['id'];
  quantity: number;
};

export interface EquippedItems {
  weapon?: Item['id'];
  helmet?: Item['id'];
  chestplate?: Item['id'];
  gloves?: Item['id'];
  boots?: Item['id'];
}

export interface InventoryDetailed {
  items: InventoryItemDetailed[];
  maxCapacity: number;
}

export interface InventoryItemDetailed {
  item: Item;
  quantity: number;
}

export interface EquippedItemsDetailed {
  weapon?: Item;
  helmet?: Item;
  chestplate?: Item;
  gloves?: Item;
  boots?: Item;
}

export interface CharacterBase {
  id: string;
  name: string;
  sprite: number;
  width: number;
  height: number;
  maxHealth: number;
  attack: number;
  attackRange: number;
}

export interface CharacterRuntime {
  position: Position;
  targetPosition?: Position;
  moving?: boolean;
  moveStartTime?: number;
  currentMoveDuration?: number;
  mapId: string;
  direction: Direction;
  action: CharacterAction;
  health: number;
  kind: 'npc' | 'player';
}

export type NpcBehavior = 'aggressive' | 'hostile' | 'neutral';

export interface PersistentNpc extends CharacterBase {
  behavior: NpcBehavior;
  experienceValue?: number;
  itemsToDrop?: NpcItemDrop[];
}

export interface RuntimeNpc extends PersistentNpc, CharacterRuntime {
  kind: 'npc';
}

export interface PersistentPlayer extends CharacterBase {
  level: number;
  experience: number;
  experienceToNextLevel: number;
  inventory: Inventory;
  equipped: EquippedItems;
  access: Access;
}

export interface PlayerServer extends PersistentPlayer, CharacterRuntime {
  speed: number;
  kind: 'player';
}

export interface Player extends Omit<PlayerServer, 'inventory' | 'equipped'> {
  inventory: InventoryItemDetailed[];
  equipped: EquippedItemsDetailed;
}

export type CombatTarget = PlayerServer | RuntimeNpc;

export interface Warp {
  to: MapStateServer['id'];
  position: Position;
}

export interface Tile {
  tileIndex: number;
  blocked?: boolean;
  warp?: Warp;
  npcSpawn?: PersistentNpc['id'];
  item?: Item['id'];
  shop?: Shop['id'];
}

export interface DroppedItem {
  itemId: Item['id'];
  position: Position;
  sprite: number;
}

export interface MapStateServer {
  id: string;
  name: string;
  type: 'pvp' | 'normal';
  players: Record<string, PlayerServer>;
  npcs: Record<string, RuntimeNpc>;
  tiles: Tile[][];
  droppedItems: DroppedItem[];
}

export interface MapStateClient {
  id: string;
  name: string;
  type: 'pvp' | 'normal';
  players: Record<string, Player>;
  npcs: Record<string, RuntimeNpc>;
  tiles: Tile[][];
  droppedItems: DroppedItem[];
}

export interface GameState {
  maps: Record<string, MapStateServer>;
}

export type PlayersServerMap = { [key: string]: PlayerServer };
export type PlayersMap = { [key: string]: Player };
export type RuntimeNpcsMap = { [key: string]: RuntimeNpc };
export type ItemsMap = { [key: number]: Item };

export interface NpcItemDrop {
  itemId: Item['id'];
  chance: number;
}

export type ChatScope = 'player' | 'map' | 'global';
export type ChatSubtype = 'death';

interface ChatBase {
  type: 'chat';
  scope: ChatScope;
  message: string;
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

export interface ServerAction {
  action: ServerActionType;
}

export type ActionQueueItem =
  | ClientKeyboardAction
  | ClientItemAction
  | ClientChatAction
  | ServerAction;

export type ActionQueue = Array<ActionQueueItem>;

export interface Shop<T = ProductRaw> {
  id: string;
  name: string;
  products: T[];
}

export interface ProductRaw {
  itemId: number;
  currency: number;
  price: number;
}

export interface ProductDetailed {
  item: Item;
  currency: Item;
  price: number;
}

export type TileEditMode = 'blocking' | 'warping' | 'npc' | 'item' | 'shop';

export interface HttpRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: any;
}
