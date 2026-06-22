import { EQUIPMENT_SLOTS } from './constants.js';

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
  o = 'o',
  e = 'e',
  v = 'v',
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

// Composable entity components; an entity is their flat intersection.

export interface Identity {
  id: string;
  name: string;
  sprite: number;
  width: number;
  height: number;
}

export interface BaseStats {
  maxHealth: number;
  attack: number;
  attackRange: number;
}

export interface Transform {
  position: Position;
  direction: Direction;
  mapId: string;
}

export interface Movement {
  targetPosition?: Position;
  moving?: boolean;
  moveTick?: number;
  moveDurationTicks?: number;
}

export interface Progression {
  level: number;
  experience: number;
  experienceToNextLevel: number;
  vitality: number;
  unspentPoints: number;
}

export interface InventoryHolder {
  inventory: Inventory;
  equipped: EquippedItems;
}

export interface CharacterBase extends Identity, BaseStats {}

export interface CharacterRuntime extends Transform, Movement {
  action: CharacterAction;
  health: number;
  kind: 'npc' | 'player';
}

export type NpcBehavior =
  | 'aggressive'
  | 'hostile'
  | 'neutral'
  | 'friendly'
  | 'shopkeeper'
  | 'guard';

export interface PersistentNpc extends CharacterBase {
  behavior: NpcBehavior;
  experienceValue?: number;
  itemsToDrop?: NpcItemDrop[];
}

export interface RuntimeNpc extends PersistentNpc, CharacterRuntime {
  kind: 'npc';
}

export interface PersistentPlayer
  extends CharacterBase,
    Progression,
    InventoryHolder {
  access: Access;
  // Free-form per-player data for game scripts (a vip flag, quest progress).
  // Server-side only, never serialized to clients.
  data?: Record<string, unknown>;
}

export interface PlayerServer extends PersistentPlayer, CharacterRuntime {
  speed: number;
  kind: 'player';
  lastProcessedSeq?: number;
}

export interface PlayerRecord extends PlayerServer {
  password: string;
}

export interface PlayerPublic {
  id: string;
  name: string;
  sprite: number;
  width: number;
  height: number;
  maxHealth: number;
  health: number;
  level: number;
  access: Access;
  position: Position;
  targetPosition?: Position;
  direction: Direction;
  action: CharacterAction;
  kind: 'player';
}

export interface Player extends Omit<PlayerServer, 'inventory' | 'equipped'> {
  inventory: InventoryItemDetailed[];
  equipped: EquippedItemsDetailed;
}

export interface PlayerHot {
  id: string;
  position: Position;
  targetPosition?: Position;
  moving?: boolean;
  moveTick?: number;
  moveDurationTicks?: number;
  direction: Direction;
  action: CharacterAction;
  health: number;
  lastProcessedSeq?: number;
}

export interface PlayerCold {
  id: string;
  name: string;
  sprite: number;
  width: number;
  height: number;
  maxHealth: number;
  attack: number;
  attackRange: number;
  level: number;
  experience: number;
  experienceToNextLevel: number;
  inventory: InventoryItemDetailed[];
  equipped: EquippedItemsDetailed;
  access: Access;
  vitality: number;
  unspentPoints: number;
  speed: number;
  mapId: string;
  kind: 'player';
}

export type CombatTarget = PlayerServer | RuntimeNpc;

export interface Warp {
  to: MapStateServer['id'];
  position: Position;
}

export type TileAction =
  | { action: 'heal' }
  | { action: 'kill' }
  | { action: 'message'; text: string };

export interface Tile {
  tileIndex: number;
  blocked?: boolean;
  warp?: Warp;
  npcSpawn?: PersistentNpc['id'];
  item?: Item['id'];
  shop?: Shop['id'];
  avoidNpc?: boolean;
  fringe?: boolean;
  triggers?: TileAction[];
}

export interface DroppedItem {
  itemId: Item['id'];
  position: Position;
  sprite: number;
  quantity: number;
}

export type MapType = 'pvp' | 'normal';

export interface MapStateBase {
  id: string;
  name: string;
  type: MapType;
  tiles: Tile[][];
  droppedItems: DroppedItem[];
  npcs: Record<string, RuntimeNpc>;
}

export interface MapStateServer extends MapStateBase {
  players: Record<string, PlayerServer>;
  tilesRevision?: number;
}

export interface MapStateClient extends MapStateBase {
  players: Record<string, PlayerPublic>;
}

export interface MapStaticClient {
  id: string;
  name: string;
  type: MapType;
  tiles: Tile[][];
}

export interface MapDynamicClient {
  id: string;
  droppedItems: DroppedItem[];
  npcs: Record<string, RuntimeNpc>;
  players: Record<string, PlayerPublic>;
}

export interface GameState {
  maps: Record<string, MapStateServer>;
}

export type PlayersServerMap = { [key: string]: PlayerServer };
export type PlayersMap = { [key: string]: PlayerPublic };
export type RuntimeNpcsMap = { [key: string]: RuntimeNpc };
export type ItemsMap = { [key: number]: Item };

export interface OnlinePlayersResponse {
  players: string[];
  count: number;
}

export interface NpcItemDrop {
  itemId: Item['id'];
  chance: number;
  quantity?: number;
}

export type ChatScope = 'player' | 'map' | 'global';
export type ChatSubtype = 'death';

interface ChatBase {
  type: 'chat';
  scope: ChatScope;
  message: string;
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

export type TileEditMode =
  | 'blocking'
  | 'warping'
  | 'npc'
  | 'item'
  | 'shop'
  | 'avoidNpc'
  | 'fringe'
  | 'heal'
  | 'kill'
  | 'warn';

export interface HttpRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: any;
}
