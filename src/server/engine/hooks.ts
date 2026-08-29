import { logger } from '../logger.js';
import type {
  PlayerServer,
  RuntimeNpc,
  MapStateServer,
  Tile,
  CombatTarget,
  ChatScope,
  DamageContributor,
  EquipmentSlot,
} from '../../shared/types.js';

export type HookMap = {
  playerJoin: { player: PlayerServer };
  playerLeave: { player: PlayerServer };
  playerDeath: { player: PlayerServer; killer?: CombatTarget };
  playerLevelUp: { player: PlayerServer; level: number };
  npcDeath: {
    npc: RuntimeNpc;
    /** Who landed the last hit, which is not necessarily who earned it. */
    killer: PlayerServer;
    /**
     * Everyone who damaged this npc, largest share first. Present so a module
     * can decide what a kill is worth (split the reward, gate a drop, credit a
     * quest) without the engine picking one policy for every game.
     */
    contributors: DamageContributor[];
  };
  npcInteract: { player: PlayerServer; npc: RuntimeNpc };
  tileEnter: { player: PlayerServer; tile: Tile; map: MapStateServer };
  itemUse: { player: PlayerServer; itemId: number };
  itemPickup: { player: PlayerServer; itemId: number; quantity: number };
  // Fire on the transition, after the slot already holds the new value. Both
  // fire on a swap, unequip first: that is one click, but two changes to what
  // the player is wearing, and a listener that recomputes from `equipped` has
  // to see each one.
  itemEquip: { player: PlayerServer; itemId: number; slot: EquipmentSlot };
  itemUnequip: { player: PlayerServer; itemId: number; slot: EquipmentSlot };
  chatMessage: { player: PlayerServer; scope: ChatScope; message: string };
  // The attack input, before the melee policy runs (cooldown, facing tile,
  // the passive-npc rule). A handler that owns combat sets `handled` and the
  // built-in melee stands down, so a game can replace the style. Damage stays
  // in the core either way.
  playerAttack: { player: PlayerServer; handled: boolean };
  beforeDamage: {
    attacker?: CombatTarget;
    target: CombatTarget;
    damage: { value: number };
  };
  afterDamage: {
    attacker?: CombatTarget;
    target: CombatTarget;
    damage: number;
    lethal: boolean;
  };
  beforeXpGain: { player: PlayerServer; amount: number; source: string };
  customAction: { player: PlayerServer; channel: string; payload: unknown };
  // Fires on the edge, when a live-ops flag starts or ends, which a scheduled
  // event needs and a read of the value cannot give.
  liveOpsFlag: {
    name: string;
    value: boolean | number | string;
    active: boolean;
  };
  /**
   * Which copy of an instanced map a player is about to walk into. `owner`
   * arrives as the player's own name, a solo run, and anything that groups
   * players (a party, a raid, a queue) replaces it with the group's name.
   * Everybody who answers the same string walks into the same copy.
   */
  instanceOwner: { player: PlayerServer; mapId: string; owner: string };
  tick: { tick: number };
};

type Handler<K extends keyof HookMap> = (payload: HookMap[K]) => void;

const registry = new Map<keyof HookMap, Set<Handler<any>>>();

export function on<K extends keyof HookMap>(
  event: K,
  handler: Handler<K>,
): () => void {
  let set = registry.get(event);
  if (!set) {
    set = new Set();
    registry.set(event, set);
  }
  set.add(handler);
  return () => {
    set.delete(handler);
  };
}

export function off<K extends keyof HookMap>(
  event: K,
  handler: Handler<K>,
): void {
  registry.get(event)?.delete(handler);
}

export function emit<K extends keyof HookMap>(
  event: K,
  payload: HookMap[K],
): void {
  const set = registry.get(event);
  if (!set || set.size === 0) return;
  // Over a copy, as a Set visits entries added during iteration: a handler
  // that subscribes to the event it handles would be called for the one in
  // flight, and a coroutine on `waitFor` would loop forever inside one emit.
  // An event reaches the handlers listening when it happened, and no others.
  const handlers = [...set];
  // A throwing or rejecting handler must never break the game loop or
  // stop sibling handlers. Isolate both sync throws and async rejections.
  for (const handler of handlers) {
    // Still subscribed? The copy above fixes one direction and would break the
    // other: a handler unsubscribed by an earlier handler in this same emit is
    // no longer listening, and must not be called from a stale copy.
    if (!set.has(handler)) continue;
    try {
      const result = handler(payload) as unknown;
      if (result instanceof Promise) {
        result.catch((err) =>
          logger.error('[hooks] async handler rejected', { event, err }),
        );
      }
    } catch (err) {
      logger.error('[hooks] handler threw', { event, err });
    }
  }
}

export function clearAll(): void {
  registry.clear();
}
