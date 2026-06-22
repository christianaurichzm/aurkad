// Type definitions for game scripts. Place this file beside your scripts
// and editors pick it up.

// Core types

interface Position {
  x: number;
  y: number;
}

interface InventorySlot {
  item: number;
  quantity: number;
}

interface Inventory {
  items: InventorySlot[];
  maxCapacity: number;
}

interface EquippedItems {
  weapon?: number;
  helmet?: number;
  armor?: number;
  shield?: number;
  boots?: number;
  [slot: string]: number | undefined;
}

/** Direction as stored at runtime: 0=Down, 1=Left, 2=Right, 3=Up. */
type Direction = 0 | 1 | 2 | 3;
type CharacterAction = 'Idle' | 'Walk' | 'Run' | 'Attack';
type NpcBehavior = 'aggressive' | 'hostile' | 'neutral' | 'friendly' | 'shopkeeper' | 'guard';
type ChatScope = 'global' | 'map' | 'player';
type MapType = 'pvp' | 'normal';

interface TileAction {
  action: 'heal' | 'kill' | 'message';
  text?: string;
}

interface Tile {
  tileIndex: number;
  blocked?: boolean;
  avoidNpc?: boolean;
  fringe?: boolean;
  triggers?: TileAction[];
}

interface MapState {
  id: string;
  name: string;
  type: MapType;
  tiles: Tile[][];
}

interface PlayerServer {
  id: string;
  name: string;
  sprite: number;
  health: number;
  maxHealth: number;
  attack: number;
  attackRange: number;
  speed: number;
  level: number;
  experience: number;
  experienceToNextLevel: number;
  vitality: number;
  unspentPoints: number;
  inventory: Inventory;
  equipped: EquippedItems;
  /** Permission level: 0 = user, 1 = mod, 2 = admin. */
  access: 0 | 1 | 2;
  mapId: string;
  position: Position;
  direction: Direction;
  action: CharacterAction;
  /** Free-form per-player data, persisted with the player. */
  data?: Record<string, unknown>;
  /** Cosmetic name color above the sprite; overrides the default access color. */
  nameColor?: string;
  kind: 'player';
}

interface RuntimeNpc {
  id: string;
  name: string;
  sprite: number;
  health: number;
  maxHealth: number;
  attack: number;
  attackRange: number;
  behavior: NpcBehavior;
  experienceValue?: number;
  mapId: string;
  position: Position;
  direction: Direction;
  action: CharacterAction;
  kind: 'npc';
}

type CombatTarget = PlayerServer | RuntimeNpc;

// Hook event payloads

interface HookPayloads {
  playerJoin:    { player: PlayerServer };
  playerLeave:   { player: PlayerServer };
  playerDeath:   { player: PlayerServer; killer?: CombatTarget };
  playerLevelUp: { player: PlayerServer; level: number };
  npcDeath:      { npc: RuntimeNpc; killer: PlayerServer };
  /** Player pressed interact (F) while facing this NPC. */
  npcInteract:   { player: PlayerServer; npc: RuntimeNpc };
  tileEnter:     { player: PlayerServer; tile: Tile; map: MapState };
  itemUse:       { player: PlayerServer; itemId: number };
  itemPickup:    { player: PlayerServer; itemId: number; quantity: number };
  chatMessage:   { player: PlayerServer; scope: ChatScope; message: string };
  beforeDamage:  { attacker: CombatTarget; target: CombatTarget; damage: { value: number } };
  /**
   * Mutate `amount` to scale XP gain (VIP 2x, say). `source` is 'kill',
   * 'script' or another tag.
   */
  beforeXpGain:  { player: PlayerServer; amount: number; source: string };
  /** A custom message from client code. The payload is untrusted input. */
  customAction:  { player: PlayerServer; channel: string; payload: unknown };
}

type HookEvent = keyof HookPayloads;
type Unsubscribe = () => void;

// Global API (available in every script without import)

/** Listen to a lifecycle event. Returns an unsubscribe function. */
declare function on<E extends HookEvent>(
  event: E,
  handler: (payload: HookPayloads[E]) => void,
): Unsubscribe;

/** Look up an online player by name. */
declare function getPlayer(name: string): PlayerServer | undefined;

/** Get all online players across all maps. */
declare function getPlayers(): PlayerServer[];

/** Add items to a player's inventory. */
declare function giveItem(player: PlayerServer, itemId: number, quantity?: number): void;

/** Remove items from a player's inventory. */
declare function removeItem(player: PlayerServer, itemId: number, quantity?: number): void;

/** Restore a player's health to max. */
declare function healPlayer(player: PlayerServer): void;

/** Kill and respawn a player. */
declare function killPlayer(player: PlayerServer): void;

/** Grant XP (passes through the beforeXpGain hook, so multipliers apply). */
declare function giveExperience(player: PlayerServer, amount: number): void;

/** Set the cosmetic name color above a player (undefined clears it). */
declare function setNameColor(player: PlayerServer, color: string | undefined): void;

/** Read a custom data field from a player. */
declare function getPlayerData<T = unknown>(player: PlayerServer, key: string): T | undefined;

/** Write a custom data field to a player (persisted). */
declare function setPlayerData(player: PlayerServer, key: string, value: unknown): void;

/**
 * Scoped key-value store, shared across players and persisted.
 * `scope` is any namespace you choose, e.g. "global", "guild:dragons".
 * Reads and writes are synchronous (backed by an in-memory cache).
 */
declare const store: {
  get<T = unknown>(scope: string, key: string): T | undefined;
  set(scope: string, key: string, value: unknown): void;
  delete(scope: string, key: string): void;
  keys(scope: string): string[];
  entries<T = unknown>(scope: string): Array<[string, T]>;
};

/** Teleport a player to a map tile (col, row). */
declare function teleportPlayer(
  player: PlayerServer,
  mapId: string,
  col: number,
  row: number,
): void;

/** Send a private message to one player. */
declare function sendMessage(player: PlayerServer, message: string): void;

/** Send a message to all online players. */
declare function broadcastMessage(message: string): void;

/**
 * Sends a custom event to one player's client code. The channel and
 * payload are yours.
 */
declare function sendEvent(player: PlayerServer, channel: string, payload?: unknown): void;

/** Send a custom event to every client on a map. */
declare function sendMapEvent(mapId: string, channel: string, payload?: unknown): void;

/** Send a custom event to all connected clients. */
declare function broadcastEvent(channel: string, payload?: unknown): void;

interface DialogOptions {
  text: string;
  /** Buttons. Omit for a single "Continue" (onChoice receives 0). */
  choices?: string[];
}

/** Show a dialog box to a player; onChoice(index) fires when they pick. */
declare function showDialog(
  player: PlayerServer,
  options: DialogOptions,
  onChoice?: (choiceIndex: number) => void,
): void;

/** Permission levels for command access. */
declare const Access: { readonly USER: 0; readonly MOD: 1; readonly ADMIN: 2 };

interface CommandContext {
  /** Present when run from chat; undefined when run from the terminal REPL. */
  player?: PlayerServer;
  args: string[];
  reply: (message: string) => void;
  source: 'chat' | 'repl';
}

interface CommandOptions {
  /** Minimum access for chat use (REPL bypasses). Defaults to everyone. */
  access?: number;
  description?: string;
}

/**
 * Register a command runnable from chat (/name args) and the REPL (name args).
 * Chat enforces `access`; the REPL operator always passes. Auto-unregistered
 * on script reload.
 */
declare function command(name: string, handler: (ctx: CommandContext) => void): void;
declare function command(
  name: string,
  options: CommandOptions,
  handler: (ctx: CommandContext) => void,
): void;

/** Runs a callback once after `ms` milliseconds; cancelled on reload. */
declare function setTimeout(callback: () => void, ms: number): void;

/** Runs a callback every `ms` milliseconds; cancelled on reload. */
declare function setInterval(callback: () => void, ms: number): NodeJS.Timeout;

/** Cancel an interval created with setInterval. */
declare function clearInterval(id: NodeJS.Timeout): void;

/** Log an info message (visible in server logs). */
declare function log(...args: unknown[]): void;

/** Log a warning. */
declare function warn(...args: unknown[]): void;

/** Log an error. */
declare function error(...args: unknown[]): void;

declare const console: {
  log: typeof log;
  warn: typeof warn;
  error: typeof error;
};
