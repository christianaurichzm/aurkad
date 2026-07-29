// Types for game scripts; editors pick this file up beside them.
//
// `Items`, `Npcs`, `Maps`, `Spells` and `Arrows` name content with
// autocomplete, as in `giveItem(player, Items.SteelSword)`. They are
// generated into `content.generated.d.ts` at boot and on every content edit.

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

type TileAction =
  | { action: 'heal' }
  | { action: 'kill' }
  | { action: 'message'; text: string }
  | { action: 'sound'; file: string }
  | { action: 'changeSprite'; spriteId: number }
  | { action: 'script'; scriptId: string };

interface Tile {
  tileIndex: number;
  blocked?: boolean;
  npcSpawn?: string;
  item?: number;
  shop?: number;
  /** Bank module: player can deposit/withdraw here (press F). */
  bank?: boolean;
  avoidNpc?: boolean;
  fringeIndex?: number;
  maskIndex?: number;
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
  strength: number;
  defense: number;
  agility: number;
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
  /** Cosmetic tag drawn above the name (e.g. a guild name). */
  nameTag?: string;
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
  beforeDamage:  { attacker?: CombatTarget; target: CombatTarget; damage: { value: number } };
  /**
   * Fires after damage is applied, with the final `damage` (read only), for
   * on-hit effects like knockback.
   */
  afterDamage:   { attacker?: CombatTarget; target: CombatTarget; damage: number; lethal: boolean };
  /**
   * Mutate `amount` to scale XP gain (VIP 2x, say). `source` is 'kill',
   * 'script' or another tag.
   */
  beforeXpGain:  { player: PlayerServer; amount: number; source: string };
  /** A custom message from client code. The payload is untrusted input. */
  customAction:  { player: PlayerServer; channel: string; payload: unknown };
  /** Fires every game tick (~20/sec). Throttle with `if (tick % n === 0)`. */
  tick:          { tick: number };
}

type HookEvent = keyof HookPayloads;
type Unsubscribe = () => void;

/** A module's config from game.json `modules`; undefined in game scripts. */
declare const config: Record<string, unknown> | undefined;

// Global API (available in every script without import)

/** Listen to a lifecycle event. Returns an unsubscribe function. */
declare function on<E extends HookEvent>(
  event: E,
  handler: (payload: HookPayloads[E]) => void,
): Unsubscribe;

/**
 * A named behavior that content points at by `scriptId`. Where `on` fires
 * for every npc, a tile trigger, npc or item names this in the editor.
 *
 *     attach('phase-two-boss', {
 *       onDeath({ npc, killer }) {
 *         spawnNpc({ npcId: Npcs.BossPhaseTwo, mapId: npc.mapId, ...npc.position });
 *       },
 *     });
 *
 * Handlers are isolated like hook handlers and dropped on reload.
 */
declare function attach(
  scriptId: string,
  behavior: EntityBehavior,
): Unsubscribe;

interface EntityBehavior {
  /** A player stepped on a tile whose `script` trigger names this behavior. */
  onEnter?(ctx: { player: PlayerServer; tile: Tile; map: MapState }): void;
  /** A player interacted with (talked to) an NPC carrying this behavior. */
  onInteract?(ctx: { player: PlayerServer; npc: RuntimeNpc }): void;
  /** An NPC carrying this behavior died. */
  onDeath?(ctx: { npc: RuntimeNpc; killer?: CombatTarget }): void;
  /**
   * A player used an item carrying this behavior. Consumables only: the
   * engine has no "equipped" event, so equipment never reaches this.
   */
  onUse?(ctx: {
    player: PlayerServer;
    item: { id: number; name: string; type: string; scriptId?: string };
    itemId: number;
  }): void;
}

/** Look up an online player by name. */
declare function getPlayer(name: string): PlayerServer | undefined;

/** Get all online players across all maps. */
declare function getPlayers(): PlayerServer[];

/** Living NPCs within `radius` px of a point (AoE spells, pet targeting). */
declare function getNearbyNpcs(mapId: string, x: number, y: number, radius: number): RuntimeNpc[];

interface SpellData {
  id: number;
  name: string;
  description: string;
  sprite: number;
  mpCost: number;
  damage: number;
  cooldownMs: number;
  visualTarget: 'self' | 'targets';
}

/** All spells defined in the database (via SpellEditor). */
declare function getSpells(): SpellData[];

/**
 * Saves spells to the database one after another, without waiting. For a
 * module seeding its built-ins in SpellEditor when getSpells() is empty.
 * `visualTarget` defaults to 'targets' when damage > 0, else 'self'.
 */
declare function createSpells(spells: {
  name: string;
  description?: string;
  sprite: number;
  mpCost: number;
  damage: number;
  cooldownMs: number;
  visualTarget?: 'self' | 'targets';
}[]): void;

interface ArrowData {
  id: number;
  name: string;
  sprite: number;
  damage: number;
  rangeTiles?: number;
  tileSpeed?: number;
}

/** Look up an arrow by numeric id. */
declare function getArrow(id: number): ArrowData | undefined;

/** All arrows defined in the database. */
declare function getArrows(): ArrowData[];

/**
 * Looks up an item by numeric id. A `bound` item cannot be dropped,
 * traded or banked.
 */
declare function getItem(id: number): { id: number; name: string; type: string; arrowId?: number; bound?: boolean } | undefined;

/** Tile size in pixels for a map (returns undefined if map doesn't exist). */
declare function getMapSize(mapId: string): { cols: number; rows: number } | undefined;

/** Returns tile info at (col, row), or null if out of bounds. */
declare function getMapTile(mapId: string, col: number, row: number): { blocked: boolean } | null;

type PvpMorale = 'safe' | 'normal' | 'no-penalty';

/** A map's PvP morale (e.g. a PK module reads this on playerDeath). */
declare function getMapPvp(mapId: string): PvpMorale;

interface SpawnNpcOptions {
  mapId: string;
  col: number;
  row: number;
  name?: string;
  sprite?: number;
  maxHealth?: number;
  attack?: number;
  attackRange?: number;
  behavior?: NpcBehavior;
}

/**
 * Spawn a runtime NPC (pet, summon, boss). Not persisted. Returns the NPC
 * to drive from on('tick'), such as moving it toward its owner.
 */
declare function spawnNpc(opts: SpawnNpcOptions): RuntimeNpc | undefined;

/** Remove a spawned NPC. */
declare function despawnNpc(npc: { id: string }): void;

/**
 * Move an NPC one tile toward (x, y) like the engine moves NPCs: sets facing,
 * respects wall collision, animates. Call at the NPC cadence (~every 25 ticks),
 * not every tick, or it teleports.
 */
declare function moveNpcToward(npc: RuntimeNpc, x: number, y: number): void;

/** Tile size in pixels (positions are pixels; tiles are TILE_SIZE apart). */
declare const TILE_SIZE: number;

/**
 * Anywhere items can live: a player inventory, a bank, a mailbox.
 * `player.inventory` is one; so is any `{ items, maxCapacity }` you keep in
 * player data.
 */
interface ItemContainer {
  items: { item: number; quantity: number }[];
  maxCapacity: number;
}

/**
 * One flat shape rather than a union, since scripts are checked with
 * `strict: false`, where narrowing on a boolean literal does not hold.
 */
interface EconomyResult {
  ok: boolean;
  /** Only set when `ok` is false. */
  reason?: 'invalid-amount' | 'not-enough' | 'no-space' | 'same-container';
}

/**
 * Add items to a player's inventory. False when it did not happen (a full
 * inventory or an unknown item), so check it before telling the player.
 */
declare function giveItem(player: PlayerServer, itemId: number, quantity?: number): boolean;

/**
 * Remove items from a player's inventory.
 *
 * All or nothing: asking for more than the player has removes nothing and
 * returns false, rather than taking what is there.
 */
declare function removeItem(player: PlayerServer, itemId: number, quantity?: number): boolean;

/** Whether the player holds at least `quantity` of an item. */
declare function hasItem(player: PlayerServer, itemId: number, quantity?: number): boolean;

/** How many of an item the player holds. */
declare function countItem(player: PlayerServer, itemId: number): number;

/** Whether the item would fit; a stack already held always does. */
declare function canCarry(player: PlayerServer, itemId: number): boolean;

/**
 * Move items between two containers, atomically.
 *
 * Both sides are checked before either is touched, so a full destination can
 * never swallow the source. This is what a bank, trade or mailbox wants
 * instead of remove-then-add.
 *
 *     const moved = moveItem(player.inventory, bank, Items.Gold, 100);
 *     if (!moved.ok) reply(moved.reason === 'no-space' ? 'Bank full.' : 'Not enough.');
 */
declare function moveItem(
  from: ItemContainer,
  to: ItemContainer,
  itemId: number,
  amount?: number,
): EconomyResult;

/**
 * Persist players to the database immediately (economic commit). Call after
 * moving items between players or containers so a crash cannot revert a
 * confirmed transfer. Failures fall back to the periodic snapshot.
 */
declare function persistNow(...players: PlayerServer[]): void;

/** Restore a player's health to max. */
declare function healPlayer(player: PlayerServer): void;

/** Kill and respawn a player. */
declare function killPlayer(player: PlayerServer): void;

/** Apply damage through combat: beforeDamage, death hooks, drops, XP. */
declare function dealDamage(target: CombatTarget, amount: number, attacker?: CombatTarget): void;

/** Grant XP (passes through the beforeXpGain hook, so multipliers apply). */
declare function giveExperience(player: PlayerServer, amount: number): void;

/** Set the cosmetic name color above a player (undefined clears it). */
declare function setNameColor(player: PlayerServer, color: string | undefined): void;

/** Set the cosmetic tag drawn above a player's name (undefined clears it). */
declare function setNameTag(player: PlayerServer, tag: string | undefined): void;

/**
 * Contribute a named source to a cosmetic field. The highest priority wins,
 * so VIP, guild and PK can each set nameColor or nameTag; setNameColor and
 * setNameTag are the low-priority base.
 */
declare function setCosmetic(
  player: PlayerServer,
  field: 'nameColor' | 'nameTag',
  source: string,
  value: string,
  priority?: number,
): void;
/** Withdraw a source's contribution; the field falls back to the next highest. */
declare function clearCosmetic(
  player: PlayerServer,
  field: 'nameColor' | 'nameTag',
  source: string,
): void;

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

/**
 * Dialog API, from the dialog module: `const dialog = use('dialog')`.
 * Shows a box and runs onChoice(index) when the player picks.
 */
interface DialogApi {
  show(
    player: PlayerServer,
    options: DialogOptions,
    onChoice?: (choiceIndex: number) => void,
  ): void;
}

interface QuestDef {
  id: string;
  name: string;
  description?: string;
  /** Progress goal; defaults to 1 (a do-once quest). */
  target?: number;
  reward?: (player: PlayerServer) => void;
}

interface QuestState {
  name: string;
  description: string;
  progress: number;
  target: number;
  status: 'active' | 'completed';
}

/**
 * Quest API, from the quest module: `const quest = use('quest')`.
 */
interface QuestApi {
  /** Register a quest definition (id, name, target, reward). */
  define(def: QuestDef): void;
  /** Start a defined quest for a player. False if unknown or already taken. */
  start(player: PlayerServer, id: string): boolean;
  /** Add to progress; auto-completes and rewards at the target. */
  advance(player: PlayerServer, id: string, amount?: number): void;
  /** Force-complete a quest and grant its reward. */
  complete(player: PlayerServer, id: string): void;
  /** Read a player's state for one quest. */
  get(player: PlayerServer, id: string): QuestState | undefined;
}

/** Publish an API for other modules/scripts to consume via use(name). */
declare function provide(name: string, api: unknown): void;

/** An API a module published with provide(name), or undefined. */
declare function use(name: 'dialog'): DialogApi | undefined;
declare function use(name: 'quest'): QuestApi | undefined;
declare function use<T = any>(name: string): T | undefined;

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
  /**
   * Extra gate for chat use, checked on top of `access` (the REPL bypasses
   * it). For permissions that aren't an access tier, e.g. a VIP flag:
   * `canRun: (p) => getPlayerData(p, 'vip') === true`.
   */
  canRun?(player: PlayerServer): boolean;
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

/**
 * Run `callback` once, `ticks` ticks from now. Returns an id for `cancel`
 * and is cancelled on script reload. Ticks keep it in step with replays;
 * `after(msToTicks(3000), fn)` when you think in seconds.
 */
declare function after(ticks: number, callback: () => void): number;

/** Run `callback` every `ticks` ticks. Returns an id for `cancel`. */
declare function every(ticks: number, callback: () => void): number;

/** Cancel a task scheduled with `after` or `every`. */
declare function cancel(id: number): void;

/** Convert milliseconds to ticks, rounded up, using the server's tick rate. */
declare function msToTicks(ms: number): number;

/** Ticks per second the server simulates at (default 20). */
declare const TICK_RATE: number;

/**
 * Deterministic random in [0, 1). Always prefer this over `Math.random`: the
 * simulation is seeded, and replay only reproduces if every roll that affects
 * the world comes from this sequence.
 */
declare function random(): number;

/** Deterministic integer in [0, maxExclusive). */
declare function randomInt(maxExclusive: number): number;

/** Deterministic true with `percent` chance (0-100). */
declare function randomChance(percent: number): boolean;

/** Deterministic pick from an array, or undefined when empty. */
declare function randomPick<T>(items: T[]): T | undefined;

/**
 * @deprecated Fires off the tick, so replay cannot reproduce it. Use `after`.
 */
declare function setTimeout(callback: () => void, ms: number): void;

/**
 * @deprecated Fires off the tick, so replay cannot reproduce it. Use `every`.
 */
declare function setInterval(callback: () => void, ms: number): number;

/** Cancel an interval created with setInterval. */
declare function clearInterval(id: number): void;

/** Log an info message (visible in server logs). */
declare function log(...args: unknown[]): void;

/** Log a warning. */
declare function warn(...args: unknown[]): void;

/** Log an error. */
declare function error(...args: unknown[]): void;
