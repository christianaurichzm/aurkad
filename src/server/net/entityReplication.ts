// Per-entity replication cache.
//
// An entity's public state is IDENTICAL for every viewer, so it is built,
// diffed and serialized ONCE per tick and the resulting fragment reused by
// everyone who can see it. Doing it per viewer is viewers x entities of
// object-graph walking, which is most of the broadcast in a crowd.
//
// Usage per tick: beginTick() -> recordEntity() for every live entity ->
// fragmentAt() per viewer, then fullBody() for one meeting the entity, or
// gapDelta()/resyncBody() for one that already knows it.

type PublicState = Record<string, unknown>;

export interface Fragment {
  /** Built on demand by `fullBody`, at most once per entity per tick. */
  full?: string;
  /** Only the fields that changed this tick; undefined when nothing changed. */
  delta: string | undefined;
  /**
   * The entity id as a JSON string, quoted once here rather than once per
   * viewer: about 1ms of a 50ms tick at 300 players in one crowd, and ~9ms if
   * a viewport ever held all 300 instead of roughly 50.
   */
  quotedId: string;
  /** This entity's slot, so a viewer can index instead of hash. */
  slot: number;
  /** Tick the current occupant took `slot`; see the slot section below. */
  born: number;
  /**
   * Last tick this entity's public state actually changed.
   *
   * A viewer that missed some ticks needs to know whether this entity is one it
   * has to be told about at all. Standing still while it slept costs nothing:
   * what it has on screen is already the truth.
   */
  changedAt: number;
  /** This tick's public state, kept for `resyncBody`. Not copied. */
  pub: PublicState;
  /** Fields this entity has had and dropped since it took its id. */
  dropped: Set<string> | undefined;
  /** Built on demand by `resyncBody`, at most once per entity per tick. */
  resync?: string;
  /** Merged deltas by gap, built on demand by `gapDelta`. Null = no answer. */
  gapBodies?: Map<number, string | null>;
}

// Last state broadcast for each entity, kept across ticks to diff against.
const previous = new Map<string, PublicState>();

// Keys an entity's public state has dropped, for `resyncBody`. A serializer
// that spreads the entity leaves an unset field out rather than undefined, so
// this tick's state alone cannot say a viewer may still hold it.
const droppedKeys = new Map<string, Set<string>>();

/**
 * How many entities still have a diff baseline.
 *
 * Published as a metric because this map is keyed by entity id and only
 * `forgetReplicatedEntity` removes an entry: if a despawn path forgets to call
 * it, the leak is invisible until memory runs out, and a recycled id inherits
 * another entity's history. Only entities on a map somebody stands on are
 * recorded, so this is at most the number alive: above that, something leaks.
 */
export function replicatedEntityCount(): number {
  return previous.size;
}
// Serialized fragments for the current tick only.
let fragments = new Map<string, Fragment>();

// Monotonic broadcast counter, starting at 1 so the 0 a fresh Int32Array
// is full of can never read as "seen on some tick".
let tick = 0;

export function beginTick(): void {
  fragments = new Map();
  tick++;
}

export function currentTick(): number {
  return tick;
}

// ---------------------------------------------------------------------------
// Entity slots: ids as small integers
//
// Per entity per tick a viewer asks: do I know this one, and which of the
// ones I knew are gone? As Set<string> membership that is a string hash per
// entity per viewer, the largest per-viewer cost in a crowd. So ids get a
// small dense integer here, in the per-map phase, and the question becomes
// an array index.
//
// The slot rides on the fragment, not the entity: a symbol-keyed load at a
// site that sees players and npcs does not inline and costs more than the
// hash, while the fragment is already looked up by id. Slots are recycled,
// which is the whole hazard (see `slotOwner`).
const slotOf = new Map<string, number>();
/**
 * Who occupies each slot right now, and since when.
 *
 * Both exist to survive recycling. A viewer remembers slots it saw; if the
 * entity that held one despawned and another took it over, the viewer's memory
 * of "slot 5" is about somebody else. `slotOwner` is what lets the leave scan
 * notice, and `slotBorn` is what stops a newcomer inheriting the previous
 * occupant's "already known" status and being sent a delta the client has
 * nothing to apply to.
 */
const slotOwner: Array<string | undefined> = [];
const slotBorn: number[] = [];
const slotChangedAt: number[] = [];
const freeSlots: number[] = [];

/**
 * The last few ticks of changes per slot, so a viewer that missed some is
 * told what happened rather than handed the entity again. Field deltas
 * merge, the later write winning, so catching up costs about one tick's
 * delta: without this, cadence cost 2.4x the bytes it was meant to save.
 *
 * Flat rings rather than an object per tick, since this is written for every
 * entity every tick and allocates nothing. `historyTick` says whether a ring
 * cell is about the tick asked for or stale.
 */
const HISTORY_TICKS = 4;
const historyTick: number[] = [];
const historyDelta: Array<PublicState | null> = [];

function historyBase(slot: number): number {
  return slot * HISTORY_TICKS;
}

/** Assigns (or confirms) this entity's slot. Per-map phase, not per viewer. */
function claimSlot(id: string): number {
  const existing = slotOf.get(id);
  if (existing !== undefined) return existing;

  const slot = freeSlots.pop() ?? slotOwner.length;
  slotOf.set(id, slot);
  slotOwner[slot] = id;
  slotBorn[slot] = tick;
  // A recycled slot arrives with the previous occupant's changes still in it,
  // and those describe somebody else.
  const base = historyBase(slot);
  for (let i = 0; i < HISTORY_TICKS; i++) {
    historyTick[base + i] = -1;
    historyDelta[base + i] = null;
  }
  return slot;
}

export function slotOwnerId(slot: number): string | undefined {
  return slotOwner[slot];
}

/** Tick the slot's current occupant took it. */
export function slotBornAt(slot: number): number | undefined {
  return slotBorn[slot];
}

/** Upper bound for sizing a per-viewer slot array. */
export function slotCapacity(): number {
  return slotOwner.length;
}

/**
 * Field-level delta over a known-shape public state. Nested values
 * (position/targetPosition) are rebuilt every tick, so they compare by
 * value. Returns null when nothing changed.
 *
 * A field that was set and is now absent is encoded as CLEARED (null), as
 * JSON.stringify drops undefined keys and the client would keep the stale
 * value, like a `targetPosition` after a player stops. No public field
 * holds null otherwise, so the client deletes the key.
 */
export const CLEARED = null;

export function fieldDelta(
  prev: PublicState,
  next: PublicState,
): PublicState | null {
  let out: PublicState | null = null;

  const emit = (key: string, value: unknown) => {
    out ??= {};
    out[key] = value === undefined ? CLEARED : value;
  };

  for (const key of Object.keys(next)) {
    const before = prev[key];
    const after = next[key];

    const changed =
      after !== null && typeof after === 'object'
        ? JSON.stringify(before) !== JSON.stringify(after)
        : before !== after;

    if (changed) emit(key, after);
  }

  // A key present before and absent now must also be transmitted.
  for (const key of Object.keys(prev)) {
    if (!(key in next)) emit(key, undefined);
  }

  return out;
}

/** Build and cache this tick's fragments for one entity. */
export function recordEntity(id: string, pub: PublicState): void {
  const prev = previous.get(id);

  const changed = prev ? fieldDelta(prev, pub) : null;
  const delta = changed ? JSON.stringify(changed) : undefined;
  for (const key in changed) {
    if (changed[key] !== CLEARED || key in pub) continue;
    const dropped = droppedKeys.get(id) ?? new Set<string>();
    droppedKeys.set(id, dropped.add(key));
  }

  const slot = claimSlot(id);
  // No baseline means this is the entity's first tick under its current id, so
  // everything about it is new even though `delta` is empty.
  if (!prev || delta !== undefined) slotChangedAt[slot] = tick;

  const cell = historyBase(slot) + (tick % HISTORY_TICKS);
  historyTick[cell] = tick;
  historyDelta[cell] = changed;

  fragments.set(id, {
    delta,
    quotedId: JSON.stringify(id),
    slot,
    born: slotBorn[slot] ?? tick,
    changedAt: slotChangedAt[slot] ?? tick,
    pub,
    dropped: droppedKeys.get(id),
  });
  previous.set(id, pub);
}

/**
 * This tick's fragment for an entity, or undefined when it was not recorded.
 * Handed out whole, since the caller needs the slot, the body and the quoted
 * id, and fetching them separately is a map lookup each.
 */
export function fragmentAt(id: string): Fragment | undefined {
  return fragments.get(id);
}

/**
 * Full state, for a viewer that does not hold this entity and inserts it
 * whole. Built on demand, as most ticks nobody meets a given entity anew.
 */
export function fullBody(fragment: Fragment): string {
  return (fragment.full ??= JSON.stringify(fragment.pub));
}

/**
 * Changes this entity accumulated over the viewer's last `gap` ticks, or null
 * when memory cannot answer: the viewer was away longer than the history, or
 * the entity was not recorded on some tick in the span (a dead npc), where a
 * merge would be a guess. The caller then falls back to `resyncBody`.
 */
export function gapDelta(fragment: Fragment, gap: number): string | null {
  if (gap === 1) return fragment.delta ?? null;
  if (gap < 1 || gap > HISTORY_TICKS || gap > tick) return null;

  const cached = fragment.gapBodies?.get(gap);
  if (cached !== undefined) return cached;

  const base = historyBase(fragment.slot);
  let merged: PublicState | null = null;
  for (let t = tick - gap + 1; t <= tick; t++) {
    const cell = base + (t % HISTORY_TICKS);
    if (historyTick[cell] !== t) {
      merged = null;
      break;
    }
    const step = historyDelta[cell];
    if (step) merged = Object.assign(merged ?? {}, step);
  }

  const body = merged ? JSON.stringify(merged) : null;
  (fragment.gapBodies ??= new Map()).set(gap, body);
  return body;
}

/**
 * Body that brings a viewer which already HAS this entity back to the
 * current state after missed ticks. Unlike `fullBody`, which a client inserts
 * whole, this is merged, and a merge cannot express "this field went away"
 * since `JSON.stringify` drops undefined keys. So absent fields are spelled
 * out as CLEARED, as the deltas do: those set to undefined and those the
 * entity once had and left out since. Built on demand, as at the default
 * cadence nobody needs it.
 */
export function resyncBody(fragment: Fragment): string {
  if (fragment.resync === undefined) {
    const cleared: PublicState = {};
    for (const key of Object.keys(fragment.pub)) {
      const value = fragment.pub[key];
      cleared[key] = value === undefined ? CLEARED : value;
    }
    for (const key of fragment.dropped ?? []) {
      if (!(key in fragment.pub)) cleared[key] = CLEARED;
    }
    fragment.resync = JSON.stringify(cleared);
  }
  return fragment.resync;
}

/**
 * Drops an entity's history on despawn or disconnect, so a recycled id can
 * never inherit another entity's diff baseline.
 */
export function forgetReplicatedEntity(id: string): void {
  previous.delete(id);
  droppedKeys.delete(id);
  fragments.delete(id);

  const slot = slotOf.get(id);
  if (slot !== undefined) {
    slotOf.delete(id);
    // Left owner-less rather than handed out again on the spot. A viewer that
    // has not been served for a while (backpressure skips ticks) still holds
    // this slot in its known list, and `slotOwner` going undefined is how the
    // leave scan tells "gone" from "someone else lives here now".
    slotOwner[slot] = undefined;
    freeSlots.push(slot);
  }
}

export function resetEntityReplication(): void {
  previous.clear();
  droppedKeys.clear();
  fragments = new Map();
  slotOf.clear();
  slotOwner.length = 0;
  slotBorn.length = 0;
  slotChangedAt.length = 0;
  historyTick.length = 0;
  historyDelta.length = 0;
  freeSlots.length = 0;
  tick = 0;
}
