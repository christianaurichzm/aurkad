// Named behaviours that content attaches to itself by id. The hook bus
// makes every game write the same `if (npc.id === ...)` dispatch, growing
// with the number of special entities. Here, as in Unity and Godot, a
// behaviour is written once under a name and the content points at it: a
// tile trigger, an npc or an item carries a `scriptId`, wired in the editor.

import { logger } from '../../logger.js';
import { recordScriptError } from './scriptErrors.js';
import {
  normalizeParamSpecs,
  resolveScriptParams,
  SCRIPT_BEHAVIOR_EVENTS,
  type ScriptBehaviorDescriptor,
  type ScriptBehaviorEvent,
  type ScriptParams,
  type ScriptParamSpec,
} from '../../../shared/scriptParams.js';
import type {
  Item,
  MapStateServer,
  PlayerServer,
  RuntimeNpc,
  Tile,
  CombatTarget,
} from '../../../shared/types.js';

/**
 * What each dispatch point supplies, before params are resolved onto it.
 *
 * Keyed by `ScriptBehaviorEvent` (shared, because the editors list the same
 * names): dropping a key here stops `BehaviorEvents[K]` below from compiling,
 * so the two cannot drift apart unnoticed.
 */
interface BehaviorEvents extends Record<ScriptBehaviorEvent, object> {
  /** A player stepped on a tile whose trigger names this behaviour. */
  onEnter: { player: PlayerServer; tile: Tile; map: MapStateServer };
  /** A player interacted with (talked to) an npc carrying this behaviour. */
  onInteract: { player: PlayerServer; npc: RuntimeNpc };
  /** An npc carrying this behaviour died. */
  onDeath: { npc: RuntimeNpc; killer?: CombatTarget };
  /** A player used an item carrying this behaviour. */
  onUse: { player: PlayerServer; item: Item; itemId: number };
}

export type EntityBehaviorEvent = ScriptBehaviorEvent;

export type EntityBehavior = {
  /**
   * Fields the editor renders for every piece of content that names this
   * behaviour, keyed by param name (shared/scriptParams.ts). Configured values
   * arrive as `ctx.params`, already coerced to the declared type.
   */
  params?: Record<string, unknown>;
} & {
  [K in EntityBehaviorEvent]?: (
    ctx: BehaviorEvents[K] & { params: ScriptParams },
  ) => void;
};

interface Registration {
  /** Script file that registered it, for error attribution and reload. */
  owner: string;
  behavior: EntityBehavior;
  specs: ScriptParamSpec[];
}

const behaviors = new Map<string, Registration>();

// One line per unknown id, not one per dispatch: a tile pointing at a deleted
// behaviour is stepped on repeatedly, and the log should say so once. Same for
// content that left a required param empty.
const unknownReported = new Set<string>();
const missingParamsReported = new Set<string>();

/**
 * Registers a behaviour, throwing if its param declaration is malformed.
 * `attach` runs at script load, so the throw reaches the handler that marks
 * the file and line in the editor; dropping the bad param instead would
 * leave a field nobody can fill and a handler reading undefined.
 */
export function registerEntityBehavior(
  scriptId: string,
  behavior: EntityBehavior,
  owner: string,
): () => void {
  const { specs, errors } = normalizeParamSpecs(behavior.params);
  if (errors.length > 0) {
    throw new Error(
      `attach("${scriptId}") has an invalid params declaration: ${errors.join('; ')}`,
    );
  }

  const existing = behaviors.get(scriptId);
  if (existing && existing.owner !== owner) {
    // Reloading a file re-registers its own ids, which is normal. Two files
    // claiming one id is not: the content gets whichever loaded last, so the
    // log says which.
    logger.warn('[behavior] id claimed by two scripts; last one wins', {
      scriptId,
      previous: existing.owner,
      current: owner,
    });
  }

  behaviors.set(scriptId, { owner, behavior, specs });
  unknownReported.delete(scriptId);
  for (const key of missingParamsReported) {
    if (key.startsWith(`${scriptId}|`)) missingParamsReported.delete(key);
  }

  return () => {
    // Only retract our own: a reload that races a different script's
    // registration must not delete the winner's entry.
    if (behaviors.get(scriptId)?.owner === owner) behaviors.delete(scriptId);
  };
}

export function getEntityBehavior(
  scriptId: string,
): EntityBehavior | undefined {
  return behaviors.get(scriptId)?.behavior;
}

/**
 * Every registered id with the params it declares, for validating content that
 * references them: an id nothing registered is a dangling reference, and a
 * stored value the declaration cannot hold is one the runtime will discard.
 */
export function registeredBehaviorParams(): ReadonlyMap<
  string,
  ScriptParamSpec[]
> {
  return new Map([...behaviors].map(([id, reg]) => [id, reg.specs]));
}

/** What the content editors need to offer a behaviour and its fields. */
export function describeBehaviors(): ScriptBehaviorDescriptor[] {
  return [...behaviors]
    .map(([id, reg]) => ({
      id,
      owner: reg.owner,
      events: SCRIPT_BEHAVIOR_EVENTS.filter((event) => !!reg.behavior[event]),
      params: reg.specs,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function clearEntityBehaviors(): void {
  behaviors.clear();
  unknownReported.clear();
  missingParamsReported.clear();
}

/**
 * Runs one behaviour handler, isolated like hook handlers: a throw is logged
 * against its script, never propagated into the tick. `storedParams` is the
 * content's `scriptParams` (npc, item or tile trigger), resolved here so
 * every dispatch point applies the same defaults and coercion. Returns
 * whether a handler ran.
 */
export function dispatchEntityScript<K extends EntityBehaviorEvent>(
  scriptId: string | undefined,
  event: K,
  payload: BehaviorEvents[K],
  storedParams?: Readonly<Record<string, unknown>> | undefined,
): boolean {
  if (!scriptId) return false;

  const registration = behaviors.get(scriptId);
  if (!registration) {
    if (!unknownReported.has(scriptId)) {
      unknownReported.add(scriptId);
      logger.warn('[behavior] content references an unregistered scriptId', {
        scriptId,
        event,
      });
    }
    return false;
  }

  const handler = registration.behavior[event];
  if (!handler) return false;

  const { params, missing } = resolveScriptParams(
    registration.specs,
    storedParams,
  );
  if (missing.length > 0) {
    const key = `${scriptId}|${event}`;
    if (!missingParamsReported.has(key)) {
      missingParamsReported.add(key);
      // The handler still runs: a behaviour may treat a param as optional in
      // one dispatch path and required in another, and refusing to run would
      // be the silent failure this whole mechanism exists to avoid.
      logger.warn('[behavior] content left required params empty', {
        scriptId,
        event,
        params: missing,
      });
    }
  }

  const ctx = { ...payload, params };

  try {
    (handler as (c: unknown) => void)(ctx);
    return true;
  } catch (err) {
    logger.error(`[behavior] ${scriptId}.${event} threw`, { err });
    recordScriptError(
      registration.owner,
      err,
      'behavior',
      `${scriptId}.${event}`,
    );
    return true;
  }
}
