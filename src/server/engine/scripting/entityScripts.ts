// Named behaviours that content attaches to itself by id. The hook bus
// makes every game write the same `if (npc.id === ...)` dispatch, growing
// with the number of special entities. Here, as in Unity and Godot, a
// behaviour is written once under a name and the content points at it: a
// tile trigger, an npc or an item carries a `scriptId`, wired in the editor.

import { logger } from '../../logger.js';
import { recordScriptError } from './scriptErrors.js';
import type {
  Item,
  MapStateServer,
  PlayerServer,
  RuntimeNpc,
  Tile,
  CombatTarget,
} from '../../../shared/types.js';

export interface EntityBehavior {
  /** A player stepped on a tile whose trigger names this behaviour. */
  onEnter?: (ctx: {
    player: PlayerServer;
    tile: Tile;
    map: MapStateServer;
  }) => void;
  /** A player interacted with (talked to) an npc carrying this behaviour. */
  onInteract?: (ctx: { player: PlayerServer; npc: RuntimeNpc }) => void;
  /** An npc carrying this behaviour died. */
  onDeath?: (ctx: { npc: RuntimeNpc; killer?: CombatTarget }) => void;
  /** A player used an item carrying this behaviour. */
  onUse?: (ctx: { player: PlayerServer; item: Item; itemId: number }) => void;
}

export type EntityBehaviorEvent = keyof EntityBehavior;

interface Registration {
  /** Script file that registered it, for error attribution and reload. */
  owner: string;
  behavior: EntityBehavior;
}

const behaviors = new Map<string, Registration>();

// One line per unknown id, not one per dispatch: a tile pointing at a deleted
// behaviour is stepped on repeatedly, and the log should say so once.
const unknownReported = new Set<string>();

export function registerEntityBehavior(
  scriptId: string,
  behavior: EntityBehavior,
  owner: string,
): () => void {
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

  behaviors.set(scriptId, { owner, behavior });
  unknownReported.delete(scriptId);

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

/** Every registered id, for validating content that references them. */
export function knownBehaviorIds(): Set<string> {
  return new Set(behaviors.keys());
}

export function clearEntityBehaviors(): void {
  behaviors.clear();
  unknownReported.clear();
}

/**
 * Runs one behaviour handler, isolated like hook handlers: a throw is logged
 * and attributed to its script, never propagated into the tick. Returns
 * whether a handler ran, so callers can tell "nothing to do" apart from
 * "ran and did nothing".
 */
export function dispatchEntityScript<K extends EntityBehaviorEvent>(
  scriptId: string | undefined,
  event: K,
  payload: Parameters<NonNullable<EntityBehavior[K]>>[0],
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

  try {
    (handler as (ctx: typeof payload) => void)(payload);
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
