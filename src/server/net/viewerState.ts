import type { PlayerServer, Position } from '../../shared/types.js';
import type { HealthChange } from '../../shared/wsProtocol.js';
import { CHUNK_SIZE, EQUIPMENT_SLOTS } from '../../shared/constants.js';

// What each viewer was last sent, kept between frames so the next one carries
// only what changed, and the calls the rest of the server makes when something
// changes that comparing live state cannot see (a despawned id, an edited item,
// a retiled chunk). snapshot.ts reads and writes the caches while it builds a
// frame; services only call the functions. Must not import a service: the
// services import this.

// Cold state as last sent to each viewer, compared in place every tick.
export const lastSentPlayerCold = new Map<string, ColdSnapshot>();
// Serialized droppedItems last sent to each viewer. Drops have no stable id to
// diff per entity, but the list is small, so a string compare is enough to
// avoid resending it every tick.
export const lastSentDroppedItems = new Map<string, string>();
// Last `self` payload sent to each viewer, so an idle player stops receiving
// identical hot state every tick.
export const lastSentSelf = new Map<string, string>();

interface ChunkState {
  mapId: string;
  revision: number;
  sent: Set<string>;
}
export const playerChunkState = new Map<string, ChunkState>();

/**
 * What one viewer currently has on screen, indexed by entity slot.
 *
 * `seen[slot]` is the tick this viewer was last told about that slot's
 * occupant, so "does the viewer know this entity" is an array read instead of
 * a string hash. `knownIds`/`knownSlots` are the same membership in the order
 * it was built, because the leave list has to name ids and a slot alone cannot
 * (it may have changed hands since).
 *
 * `lastTick` is per viewer rather than global: a congested client
 * is skipped for a tick or more, and its knowledge is still whatever it was
 * when it was last served.
 */
export interface InterestState {
  seen: Int32Array;
  knownIds: string[];
  knownSlots: number[];
  lastTick: number;
  /** Which tick of the cadence cycle this viewer is served on. */
  phase: number;
}
export const playerInterestSets = new Map<string, InterestState>();

// Hits and heals since the last broadcast, per map. They ride the world update
// of each viewer that has the spot in view instead of a message of their own
// to the whole map, and are dropped once broadcast: a viewer skipped that tick
// (backpressure, cadence) loses the numbers, never any state.
export const pendingHealthChanges = new Map<string, HealthChange[]>();
export const NO_HEALTH_CHANGES: HealthChange[] = [];

/** A number to draw over `entity`: what it just lost (negative) or gained. */
export function recordHealthChange(
  entity: { id: string; mapId: string; position: Position },
  delta: number,
): void {
  const whole = Math.round(delta);
  if (!whole) return;
  let changes = pendingHealthChanges.get(entity.mapId);
  if (!changes) pendingHealthChanges.set(entity.mapId, (changes = []));
  changes.push({
    id: entity.id,
    x: entity.position.x,
    y: entity.position.y,
    delta: whole,
  });
}

export function resetPlayerNetState(name: string) {
  lastSentPlayerCold.delete(name);
  lastSentDroppedItems.delete(name);
  lastSentSelf.delete(name);
  playerChunkState.delete(name);
  playerInterestSets.delete(name);
}

/**
 * Drops the cold state cached for every viewer last sent `itemId`, so the next
 * tick resends it with the item's current definition. The snapshot compares
 * held ids and quantities, never what an item is, so an edit or deletion in
 * the catalogue is invisible to it.
 */
export function forgetSentItem(itemId: number) {
  for (const [name, snapshot] of lastSentPlayerCold) {
    if (coldSnapshotHolds(snapshot, itemId)) lastSentPlayerCold.delete(name);
  }
}

/**
 * Entries held per viewer, published as metrics. All five are keyed by
 * player name and emptied only by `resetPlayerNetState`, so a disconnect
 * path that misses it leaks an entry per session, seen only as these
 * numbers drifting above the online count over hours.
 */
export function viewerCacheSizes(): {
  cold: number;
  drops: number;
  self: number;
  chunks: number;
  interest: number;
} {
  return {
    cold: lastSentPlayerCold.size,
    drops: lastSentDroppedItems.size,
    self: lastSentSelf.size,
    chunks: playerChunkState.size,
    interest: playerInterestSets.size,
  };
}

export const chunkKey = (cx: number, cy: number) => `${cx}:${cy}`;

/**
 * Has every viewer on `mapId` receive the chunk holding (col, row) again, for
 * one tile changed while the map is live. Bumping the map's revision would do
 * it too, by resending the whole map to everyone on it.
 */
export function resendChunkAt(mapId: string, col: number, row: number) {
  const key = chunkKey(
    Math.floor(col / CHUNK_SIZE),
    Math.floor(row / CHUNK_SIZE),
  );
  for (const state of playerChunkState.values()) {
    if (state.mapId === mapId) state.sent.delete(key);
  }
}

/**
 * What a viewer was last told about a player's cold state, compared field
 * by field every tick rather than serialized, so idle players cost no
 * string per tick. Driven by values, not a dirty flag, since warps, mod
 * routes, the REPL and level-ups change cold fields outside `updatePlayer`.
 * Loose parallel arrays rather than a `PlayerCold`, which would have to be
 * built every tick to compare against.
 */
export interface ColdSnapshot {
  scalars: unknown[];
  inventory: number[];
  inventoryLength: number;
  inventoryCapacity: number | undefined;
  equipped: Array<number | undefined>;
}

export function createColdSnapshot(): ColdSnapshot {
  return {
    // Not pre-filled: `undefined` in every slot means the first
    // comparison always reports a change, so a new viewer gets a full payload.
    scalars: [],
    inventory: [],
    inventoryLength: -1,
    inventoryCapacity: undefined,
    equipped: [],
  };
}

/**
 * Syncs `snapshot` to the player's current cold state, returning whether
 * anything differed. Every field is compared and written in one pass with
 * no early return, so a caller ignoring the result still leaves it
 * consistent. The field list must match `toPlayerCold`; the tests read the
 * fields off it and fail on one this misses.
 */
export function updateColdSnapshot(
  player: PlayerServer,
  snapshot: ColdSnapshot,
): boolean {
  let changed = false;

  const s = snapshot.scalars;
  if (s[0] !== player.name) {
    s[0] = player.name;
    changed = true;
  }
  if (s[1] !== player.sprite) {
    s[1] = player.sprite;
    changed = true;
  }
  if (s[2] !== player.width) {
    s[2] = player.width;
    changed = true;
  }
  if (s[3] !== player.height) {
    s[3] = player.height;
    changed = true;
  }
  if (s[4] !== player.maxHealth) {
    s[4] = player.maxHealth;
    changed = true;
  }
  if (s[5] !== player.attack) {
    s[5] = player.attack;
    changed = true;
  }
  if (s[6] !== player.attackRange) {
    s[6] = player.attackRange;
    changed = true;
  }
  if (s[7] !== player.level) {
    s[7] = player.level;
    changed = true;
  }
  if (s[8] !== player.experience) {
    s[8] = player.experience;
    changed = true;
  }
  if (s[9] !== player.experienceToNextLevel) {
    s[9] = player.experienceToNextLevel;
    changed = true;
  }
  if (s[10] !== player.access) {
    s[10] = player.access;
    changed = true;
  }
  if (s[11] !== player.strength) {
    s[11] = player.strength;
    changed = true;
  }
  if (s[12] !== player.defense) {
    s[12] = player.defense;
    changed = true;
  }
  if (s[13] !== player.agility) {
    s[13] = player.agility;
    changed = true;
  }
  if (s[14] !== player.vitality) {
    s[14] = player.vitality;
    changed = true;
  }
  if (s[15] !== player.unspentPoints) {
    s[15] = player.unspentPoints;
    changed = true;
  }
  if (s[16] !== player.speed) {
    s[16] = player.speed;
    changed = true;
  }
  if (s[17] !== player.mapId) {
    s[17] = player.mapId;
    changed = true;
  }
  if (s[18] !== player.nameColor) {
    s[18] = player.nameColor;
    changed = true;
  }
  if (s[19] !== player.nameTag) {
    s[19] = player.nameTag;
    changed = true;
  }
  if (s[20] !== player.nameTagColor) {
    s[20] = player.nameTagColor;
    changed = true;
  }

  const items = player.inventory?.items;
  const count = items?.length ?? 0;
  if (snapshot.inventoryLength !== count) {
    snapshot.inventoryLength = count;
    changed = true;
  }
  const capacity = player.inventory?.maxCapacity;
  if (snapshot.inventoryCapacity !== capacity) {
    snapshot.inventoryCapacity = capacity;
    changed = true;
  }
  // Flattened into id/quantity pairs so the common case reads one array of
  // numbers. Entries past `count` are left stale: a shrink already reported a
  // change through the length, and they are overwritten before being read.
  const inv = snapshot.inventory;
  for (let i = 0; i < count; i++) {
    const entry = items[i]!;
    const at = i * 2;
    if (inv[at] !== entry.item) {
      inv[at] = entry.item;
      changed = true;
    }
    if (inv[at + 1] !== entry.quantity) {
      inv[at + 1] = entry.quantity;
      changed = true;
    }
  }

  const equippedSource = player.equipped;
  const eq = snapshot.equipped;
  for (let i = 0; i < EQUIPMENT_SLOTS.length; i++) {
    const value = equippedSource?.[EQUIPMENT_SLOTS[i]!];
    if (eq[i] !== value) {
      eq[i] = value;
      changed = true;
    }
  }

  return changed;
}

/** Whether `snapshot` last recorded `itemId` in the inventory or equipped. */
export function coldSnapshotHolds(
  snapshot: ColdSnapshot,
  itemId: number,
): boolean {
  for (let i = 0; i < snapshot.inventoryLength; i++) {
    if (snapshot.inventory[i * 2] === itemId) return true;
  }
  return snapshot.equipped.includes(itemId);
}
