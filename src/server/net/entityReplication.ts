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

interface Fragment {
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
}

// Last state broadcast for each entity, kept across ticks to diff against.
const previous = new Map<string, PublicState>();
// Serialized fragments for the current tick only.
let fragments = new Map<string, Fragment>();

export function beginTick(): void {
  fragments = new Map();
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

  fragments.set(id, { full, delta, quotedId: JSON.stringify(id) });
  previous.set(id, pub);
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

/**
 * This tick's `"id":fragment` pair for one viewer, ready to concatenate.
 *
 * Returning the joined pair rather than the fragment alone is what lets the
 * quoted id be computed once per entity instead of once per entity per viewer.
 */
export function entryFor(
  id: string,
  viewerKnowsEntity: boolean,
): string | undefined {
  const fragment = fragments.get(id);
  if (!fragment) return undefined;
  const body = viewerKnowsEntity ? fragment.delta : fragment.full;
  if (body === undefined) return undefined;
  return `${fragment.quotedId}:${body}`;
}

/** Drop an entity's history (despawn/disconnect) so ids cannot leak state. */
export function forgetEntity(id: string): void {
  previous.delete(id);
  fragments.delete(id);
}

export function resetEntityReplication(): void {
  previous.clear();
  fragments = new Map();
}
