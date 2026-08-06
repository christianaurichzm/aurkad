// Per-entity replication cache.
//
// The point of this module (audit F-20 / ADR-0017): an entity's public state is
// IDENTICAL for every viewer, so it must be built, diffed and serialized ONCE
// per tick and the resulting fragment reused by everyone who can see it. The
// previous design rebuilt and re-diffed it once per viewer, which is O(N^2)
// object-graph walking and measured at 70% of broadcast CPU.
//
// Usage per tick: beginTick() -> recordEntity() for every live entity ->
// fragmentFor() per viewer.

type PublicState = Record<string, unknown>;

export interface Fragment {
  /** Full state, for an entity entering a viewport. */
  full: string;
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
}

// Last state broadcast for each entity, kept across ticks to diff against.
const previous = new Map<string, PublicState>();

/**
 * How many entities still have a diff baseline.
 *
 * Published as a metric because this map is keyed by entity id and only
 * `forgetReplicatedEntity` removes an entry: if a despawn path forgets to call
 * it, the leak is invisible until memory runs out, and a recycled id inherits
 * another entity's history. Compared with live entities, this is the check.
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
const freeSlots: number[] = [];

/** Assigns (or confirms) this entity's slot. Per-map phase, not per viewer. */
function claimSlot(id: string): number {
  const existing = slotOf.get(id);
  if (existing !== undefined) return existing;

  const slot = freeSlots.pop() ?? slotOwner.length;
  slotOf.set(id, slot);
  slotOwner[slot] = id;
  slotBorn[slot] = tick;
  return slot;
}

export function slotOwnerId(slot: number): string | undefined {
  return slotOwner[slot];
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
  const full = JSON.stringify(pub);

  let delta: string | undefined;
  if (prev) {
    const changed = fieldDelta(prev, pub);
    if (changed) delta = JSON.stringify(changed);
  }

  const slot = claimSlot(id);
  fragments.set(id, {
    full,
    delta,
    quotedId: JSON.stringify(id),
    slot,
    born: slotBorn[slot] ?? tick,
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
 * Serialized fragment to send to one viewer, or undefined when there is
 * nothing to send. A viewer that already knows the entity gets only the
 * changed fields; a viewer seeing it for the first time gets the full state,
 * which is what lets the client merge-or-insert without a marker on the wire.
 */
export function fragmentFor(
  id: string,
  viewerKnowsEntity: boolean,
): string | undefined {
  const fragment = fragments.get(id);
  if (!fragment) return undefined;
  return viewerKnowsEntity ? fragment.delta : fragment.full;
}

/** Drop an entity's history (despawn/disconnect) so ids cannot leak state. */
export function forgetEntity(id: string): void {
  previous.delete(id);
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
  fragments = new Map();
  slotOf.clear();
  slotOwner.length = 0;
  slotBorn.length = 0;
  freeSlots.length = 0;
  tick = 0;
}
