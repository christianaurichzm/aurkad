import { EQUIPMENT_SLOTS } from './constants.js';
import type { ScriptParams } from './scriptParams.js';

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

export type ItemType =
  (typeof EQUIPMENT_SLOTS)[number] | 'consumable' | 'money';

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
  // Values for the params that behaviour declares (shared/scriptParams.ts).
  scriptParams?: ScriptParams;
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

/** Where a piece of equipment goes; the names of `EQUIPMENT_SLOTS`. */
export type EquipmentSlot = keyof EquippedItems;

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
  /** What equipping each slot added to the stats, taken off on unequip. */
  equippedEffects?: Partial<Record<EquipmentSlot, Effect[]>>;
}

export interface CharacterBase extends Identity, BaseStats {}

export interface CharacterRuntime extends Transform, Movement {
  action: CharacterAction;
  health: number;
  kind: 'npc' | 'player';
}

export type NpcBehavior =
  'aggressive' | 'hostile' | 'neutral' | 'friendly' | 'shopkeeper' | 'guard';

export interface PersistentNpc extends CharacterBase {
  behavior: NpcBehavior;
  experienceValue?: number;
  /** Weighted loot table to roll on death; without one, nothing drops. */
  lootTableId?: LootTable['id'];
  /**
   * Authored conversation to open when a player talks to this npc. The dialog
   * module reads it; with the module off the field is inert content, like a
   * spell nobody casts.
   */
  dialogId?: Dialog['id'];
  /**
   * Quest this npc offers on interact. The direct door, for a giver with
   * nothing to say; the other one is a dialog choice whose action is
   * `questStart:<id>`, which is how an offer that can be turned down is
   * written. Both end in the same `quest.start`.
   */
  questId?: Quest['id'];
  // Names a behaviour a script registered with attach(); runs on interact and
  // on death. This is what lets a designer wire a boss to its logic in the
  // editor instead of the script matching on npc ids.
  scriptId?: string;
  // Values for the params that behaviour declares, so two NPCs can share
  // one behaviour with different settings. Only declared keys are honoured,
  // as shared/scriptParams.ts defines.
  scriptParams?: ScriptParams;
  /**
   * How far, in tiles, this npc notices a player on its own. Absent means the
   * default for its behaviour (aggressive 8, hostile 4). Being hit ignores it:
   * an attacker is a target at any distance.
   */
  sight?: number;
  /**
   * How many tiles deep the path search looks, and so how clever the chase is.
   * Absent means 30 (rounds any obstacle a screen holds); 0 turns the search
   * off, leaving an animal that walks straight at you and bumps into walls.
   */
  pathDepth?: number;
  /**
   * How far from its spawn this npc follows a target before giving up and
   * walking back. Absent means 12 tiles; 0 means no rope at all, for a boss
   * that should hunt across the map.
   */
  leash?: number;
  /**
   * Milliseconds between this npc's steps, its speed. Absent means the
   * game-wide `combat.npcUpdateIntervalMs` (1250 by default). Rounded up to a
   * whole tick, so 50 is the floor at 20 Hz. The client receives that result,
   * never absent: the time it slides one step over.
   */
  moveIntervalMs?: number;
  /**
   * Milliseconds a killed npc stays gone before it comes back at one of its
   * spawn tiles. Absent or 0 brings it back at once, the tick it dies.
   */
  respawnMs?: number;
}

export interface RuntimeNpc extends PersistentNpc, CharacterRuntime {
  kind: 'npc';
  templateId?: string;
  /**
   * Does not step onto another npc. Npcs otherwise pass through each other,
   * which keeps a path full of them moving but leaves a horde chasing one
   * player stacked on a single tile. Only spawnNpc sets it.
   */
  solid?: boolean;
}

export interface PersistentPlayer
  extends CharacterBase, Progression, InventoryHolder {
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
  // The CSS colour nameTag is drawn in; unset, the client's default.
  nameTagColor?: string;
  // The language this session reads, sent by its client. Runtime-only and
  // not persisted: the browser remembers the choice, and one account on two
  // machines can be read in two languages.
  language?: string;
  // Runtime-only: per-source contributions to cosmetic fields, resolved by
  // highest priority into nameColor/nameTag, so VIP, guild and PK flag can
  // set the same cosmetic without clobbering each other.
  cosmetics?: Partial<
    Record<
      'nameColor' | 'nameTag',
      Record<string, { value: string; priority: number; color?: string }>
    >
  >;
}

export interface PlayerRecord extends PlayerServer {
  password: string;
  /**
   * The account generation a session must match to still be honoured.
   * Access level and password are copied into a session when it is minted,
   * so without a generation to compare, a session outlives its facts: a
   * demoted operator keeps ADMIN, and a reset leaves whoever held the
   * previous password logged in. Bumping this ends those sessions.
   *
   * On the record, not `PlayerServer`, like the password and email: the
   * write-behind loop `$set`s the runtime player over the document every 30
   * seconds, and a field it does not carry is one it cannot wipe. Absent
   * means generation 0.
   */
  authEpoch?: number;
  /**
   * Where a reset link is sent, once the address has answered one. On the
   * record and not on `PlayerServer`, like the password next to it, so the
   * write-behind loop that `$set`s the runtime player cannot wipe it.
   */
  email?: string;
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
  nameTagColor?: string;
  kind: 'player';
}

export interface Player extends Omit<PlayerServer, 'inventory' | 'equipped'> {
  inventory: InventoryItemDetailed[];
  /** How many different items the bag holds, to set beside how many it has. */
  inventoryCapacity: number;
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
  inventoryCapacity: number;
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
  nameTagColor?: string;
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
  | { action: 'script'; scriptId: string; scriptParams?: ScriptParams };

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

/**
 * A tile as the game client sees it: what to draw, and nothing else. The
 * rest of a `Tile` is the server's copy of the rules (step scripts and
 * their arguments, where a warp goes, what a door wants, which NPC spawns
 * there); a client told any of it reads the puzzle off the wire. The
 * editor asks for the real thing over its own gated route.
 */
export interface TilePublic {
  tileIndex: number;
  maskIndex?: number;
  fringeIndex?: number;
}

export interface DroppedItem {
  itemId: Item['id'];
  position: Position;
  sprite: number;
  quantity: number;
  /** Added on the wire for the pick-up prompt: the client has no catalog. */
  name?: string;
}

/** A drop as the server keeps it. */
export interface GroundItem extends DroppedItem {
  /** The tick it vanishes on; absent for one that stays (placed by the map). */
  expiresAtTick?: number;
}

export type MapType = 'pvp' | 'normal';
export type MapOrientation = 'orthogonal' | 'isometric';

// Map "morale": safe = no player-vs-player; normal = PvP with a PK penalty;
// no-penalty = free PvP. When unset it derives from `type` (pvp -> no-penalty,
// else safe) for back-compat.
export type PvpMorale = 'safe' | 'normal' | 'no-penalty';

/**
 * Walking off one edge of a map continues on `to`, entering from its opposite
 * edge at the same row (left/right) or column (up/down), so every tile of the
 * edge leads to its neighbour. `offset` lines up maps of different sizes: row
 * r here is row r + offset there. `position` instead sends the whole edge to
 * one fixed tile.
 */
export interface BorderLink {
  to: MapStateServer['id'];
  offset?: number;
  position?: Position;
}

export interface BorderLinks {
  up?: BorderLink;
  down?: BorderLink;
  left?: BorderLink;
  right?: BorderLink;
}

export interface MapStateBase {
  id: string;
  name: string;
  type: MapType;
  pvp?: PvpMorale;
  orientation?: MapOrientation;
  tiles: Tile[][];
  droppedItems: DroppedItem[];
  npcs: Record<string, RuntimeNpc>;
  music?: string;
  borderLinks?: BorderLinks;
  /**
   * Entered as a private copy per player or party, rather than as a place
   * where everybody meets. Nobody ever stands on the map itself: it is the
   * blueprint the copies are made from (see services/world/instanceService).
   */
  instanced?: boolean;
}

export interface MapStateServer extends MapStateBase {
  players: Record<string, PlayerServer>;
  tilesRevision?: number;
  droppedItems: GroundItem[];
}

export interface MapStateClient extends MapStateBase {
  players: Record<string, PlayerPublic>;
}

export interface MapStaticClient {
  id: string;
  name: string;
  type: MapType;
  pvp?: PvpMorale;
  orientation?: MapOrientation;
  tiles: TilePublic[][];
}

export interface MapMetaClient {
  id: string;
  name: string;
  type: MapType;
  pvp?: PvpMorale;
  orientation?: MapOrientation;
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
  /** Who the spell acts on: enemies take `damage`, the rest get `heal`. */
  target: 'enemies' | 'self' | 'party' | 'guild';
  /** HP restored per target; 0 restores to full. */
  heal: number;
  /** Consecutive sheet sprites, starting at `sprite`, played as one effect. */
  frames: number;
  visualTarget: 'self' | 'targets';
  /** Its hotbar slot's tile on the spell sheet; none shows an effect frame. */
  icon?: number | null;
}

export interface MapChunkPayload {
  mapId: string;
  revision: number;
  chunkX: number;
  chunkY: number;
  tiles: TilePublic[][];
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

export interface OnlinePlayersResponse {
  players: string[];
  count: number;
}

/**
 * The drop list an npc carries in databases and content packs from before
 * loot tables. It is read once, turned into a table of its own and never
 * written again (see `dropsToLootTable` and the v2 step in dbService).
 */
export interface NpcItemDrop {
  itemId: Item['id'];
  /** 0..1. NOT the 0-100 that the scripting API's randomChance() takes. */
  chance: number;
  quantity?: number;
}

/** A fixed amount, or a range rolled per drop. */
export type LootQuantity = number | { min: number; max: number };

/**
 * One player's share of the damage dealt to an entity. Here rather than
 * beside the ledger because it travels through `HookMap`, and hooks.ts
 * importing from services/combat would close a cycle.
 */
export interface DamageContributor {
  playerId: string;
  damage: number;
}

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
  /**
   * Names a predicate a script registered as `lootCondition.<name>`, shaped
   * like a tile's `conditionalBlock`. The entry leaves the table when it
   * answers false, before any roll, so a failed condition holds no weight in
   * the pool. It receives the killer, the npc and the killer's damage, for
   * "only drops for whoever fought it".
   */
  condition?: string;
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

export interface DialogChoice {
  /** What the player sees on the button. */
  label: string;
  /**
   * Node this choice leads to. Absent ends the conversation, which is how a
   * "Goodbye" is written, with no terminal node to author.
   */
  next?: DialogNode['id'];
  /**
   * Names a predicate a script registered as `dialogCondition.<name>`, in the
   * same shape as a loot entry's condition. The choice is not offered when it
   * answers false, so a locked option is absent rather than shown and refused.
   */
  condition?: string;
  /**
   * Names a handler a script registered as `dialogAction.<name>`, run when the
   * player picks this choice. This is the seam where an authored conversation
   * reaches game logic (give an item, start a quest) without the document
   * growing a scripting language of its own.
   */
  action?: string;
}

export interface DialogNode {
  /** Unique within the dialog; what `start` and `next` point at. */
  id: string;
  text: string;
  /** No choices means a single "Continue" that ends the conversation. */
  choices?: DialogChoice[];
}

/**
 * An authored conversation: nodes of text, each offering choices that lead
 * to other nodes. A document of its own rather than fields on the npc: two
 * npcs open the same one, a fix lands in one place, and its references are
 * checked on save, where a copy per npc would escape both validation and
 * the content pack.
 */
export interface Dialog {
  id: string;
  name: string;
  /** Node the conversation opens on. Defaults to the first one. */
  start?: DialogNode['id'];
  nodes: DialogNode[];
}

/**
 * What a quest asks for. A closed union, as each arm is wired to a hook
 * the engine emits (kill to npcDeath, collect to itemPickup, talk to
 * npcInteract, reach to tileEnter), so the quest module advances progress
 * with no script. A rule that does not fit belongs in `Quest.reward.script`
 * or a dialog action.
 */
export type QuestObjective =
  | { type: 'kill'; npcId: PersistentNpc['id']; count: number }
  | { type: 'collect'; itemId: Item['id']; count: number }
  | { type: 'talk'; npcId: PersistentNpc['id'] }
  | { type: 'reach'; mapId: string; row: number; col: number };

export interface QuestReward {
  experience?: number;
  items?: Array<{ itemId: Item['id']; quantity: number }>;
  /**
   * Names a handler a script registered as `questReward.<name>`, run on
   * completion after the declarative rewards above. The escape hatch for a
   * payout the document cannot describe (unlock a door, start a follow-up),
   * in the same shape as a dialog action.
   */
  script?: string;
}

/**
 * An authored quest: one objective, a reward, and the tracker's text.
 * One objective, since per-player progress is a single
 * `progress`/`target` pair and the shipped tracker draws exactly that;
 * a chain is written as several quests.
 */
export interface Quest {
  id: string;
  name: string;
  description?: string;
  objective: QuestObjective;
  reward?: QuestReward;
}

export interface RecipeIngredient {
  itemId: Item['id'];
  quantity: number;
}

/**
 * A crafting recipe: what it consumes and what it produces. Content, not
 * module state: a recipe is referenced by id and reused, so the editor owns
 * it and the `crafting` module owns what making something means, as with
 * `Spell` and `magic`. One output, so a craft stays a straight "take
 * these, give that" through the economy funnel.
 */
export interface Recipe {
  id: string;
  name: string;
  /** Consumed on a successful craft. */
  inputs: RecipeIngredient[];
  output: RecipeIngredient;
  /**
   * Names a predicate a script registered as `recipeCondition.<name>`, in the
   * same shape as a loot entry's condition. Answering false hides the recipe
   * rather than failing the craft, which is how "you have not learned this
   * yet" is written without the document growing a skill system.
   */
  condition?: string;
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
