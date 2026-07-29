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
  f = 'f',
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
  | 'strength'
  | 'defense'
  | 'agility'
  | 'vitality'
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

export interface Arrow {
  id: number;
  name: string;
  description: string;
  sprite: number;
  damage: number;
  rangeTiles?: number;
  tileSpeed?: number;
}

export interface Item {
  id: number;
  name: string;
  description: string;
  sprite: number;
  type: ItemType;
  effects?: Effect[];
  arrowId?: number;
  // Bound items cannot be dropped, traded, or banked.
  bound?: boolean;
  // Names a behaviour a script registered with attach(); runs on use.
  scriptId?: string;
}

/**
 * Anything items can live in: a player inventory, a bank, a mailbox.
 * economyService works on this rather than on Inventory, so one set of
 * capacity and transfer rules covers every container.
 */
export interface InventoryLike {
  items: InventoryItem[];
  maxCapacity: number;
}

export type Inventory = InventoryLike;

export type InventoryItem = {
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
  strength: number;
  defense: number;
  agility: number;
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
  /**
   * Weighted loot table to roll on death. Takes precedence over
   * `itemsToDrop`, which stays supported as the simple per-item form.
   */
  lootTableId?: LootTable['id'];
  // Names a behaviour a script registered with attach(); runs on interact and
  // on death. This is what lets a designer wire a boss to its logic in the
  // editor instead of the script matching on npc ids.
  scriptId?: string;
}

export interface RuntimeNpc extends PersistentNpc, CharacterRuntime {
  kind: 'npc';
  templateId?: string;
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
  // Optional override for the colour of the name above the sprite.
  // Runtime-only; scripts set it (on join, say). Falls back to access colour.
  nameColor?: string;
  // Optional tag drawn above the name (e.g. a guild name). Runtime-only.
  nameTag?: string;
  // Runtime-only: per-source contributions to cosmetic fields, resolved by
  // highest priority into nameColor/nameTag, so VIP, guild and PK flag can
  // set the same cosmetic without clobbering each other.
  cosmetics?: Partial<
    Record<
      'nameColor' | 'nameTag',
      Record<string, { value: string; priority: number }>
    >
  >;
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
  nameColor?: string;
  nameTag?: string;
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
  strength: number;
  defense: number;
  agility: number;
  vitality: number;
  unspentPoints: number;
  speed: number;
  mapId: string;
  nameColor?: string;
  nameTag?: string;
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
  | { action: 'message'; text: string }
  | { action: 'sound'; file: string }
  | { action: 'changeSprite'; spriteId: number }
  | { action: 'script'; scriptId: string };

export interface Tile {
  tileIndex: number;
  blocked?: boolean;
  warp?: Warp;
  npcSpawn?: PersistentNpc['id'];
  item?: Item['id'];
  shop?: Shop['id'];
  bank?: boolean;
  avoidNpc?: boolean;
  fringeIndex?: number;
  maskIndex?: number;
  triggers?: TileAction[];
  door?: { requiresItem: number; openTileIndex: number };
  conditionalBlock?: string;
}

export interface DroppedItem {
  itemId: Item['id'];
  position: Position;
  sprite: number;
  quantity: number;
}

export type MapType = 'pvp' | 'normal';

// Map "morale": safe = no player-vs-player; normal = PvP with a PK penalty;
// no-penalty = free PvP. When unset it derives from `type` (pvp -> no-penalty,
// else safe) for back-compat.
export type PvpMorale = 'safe' | 'normal' | 'no-penalty';

export interface BorderLinks {
  up?: Warp;
  down?: Warp;
  left?: Warp;
  right?: Warp;
}

export interface MapStateBase {
  id: string;
  name: string;
  type: MapType;
  pvp?: PvpMorale;
  tiles: Tile[][];
  droppedItems: DroppedItem[];
  npcs: Record<string, RuntimeNpc>;
  music?: string;
  borderLinks?: BorderLinks;
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
  pvp?: PvpMorale;
  tiles: Tile[][];
}

export interface MapMetaClient {
  id: string;
  name: string;
  type: MapType;
  pvp?: PvpMorale;
  cols: number;
  rows: number;
  revision: number;
  music?: string;
}

export interface Spell {
  id: number;
  name: string;
  description: string;
  sprite: number;
  mpCost: number;
  damage: number;
  cooldownMs: number;
  visualTarget: 'self' | 'targets';
}

export interface MapChunkPayload {
  mapId: string;
  revision: number;
  chunkX: number;
  chunkY: number;
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
  /** 0..1. NOT the 0-100 that the scripting API's randomChance() takes. */
  chance: number;
  quantity?: number;
}

/** A fixed amount, or a range rolled per drop. */
export type LootQuantity = number | { min: number; max: number };

export interface LootEntry {
  itemId: Item['id'];
  /**
   * Relative weight within `entries`, meaningful only there: 30 against 10
   * is three times as likely, with no probabilities to keep summing to 1 as
   * items are added.
   */
  weight?: number;
  /** 0..1, only meaningful in `guaranteed`. Defaults to 1 (always). */
  chance?: number;
  quantity?: LootQuantity;
}

/**
 * Named, reusable drop table.
 *
 * Two independent parts, because designers think in both: `guaranteed` entries
 * each roll their own chance (the quest key, the boss trophy), while `entries`
 * is a weighted pool drawn `rolls` times (the random loot).
 */
export interface LootTable {
  id: string;
  name: string;
  guaranteed?: LootEntry[];
  /** How many draws from `entries`. Defaults to exactly one. */
  rolls?: { min: number; max: number };
  entries?: LootEntry[];
  /**
   * Weight of drawing nothing, competing with `entries`. This is how a pool
   * models "usually nothing", without a fake item to represent it.
   */
  emptyWeight?: number;
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
  | 'bank'
  | 'avoidNpc'
  | 'fringe'
  | 'mask'
  | 'heal'
  | 'kill'
  | 'warn'
  | 'door'
  | 'sound'
  | 'changeSprite'
  | 'script'
  | 'conditionalBlock';

export interface HttpRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: any;
}
