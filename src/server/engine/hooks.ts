import { logger } from '../logger.js';
import type {
  PlayerServer,
  RuntimeNpc,
  MapStateServer,
  Tile,
  CombatTarget,
  ChatScope,
} from '../../shared/types.js';

export type HookMap = {
  playerJoin:    { player: PlayerServer };
  playerLeave:   { player: PlayerServer };
  playerDeath:   { player: PlayerServer; killer?: CombatTarget };
  playerLevelUp: { player: PlayerServer; level: number };
  npcDeath:      { npc: RuntimeNpc; killer: PlayerServer };
  tileEnter:     { player: PlayerServer; tile: Tile; map: MapStateServer };
  itemUse:       { player: PlayerServer; itemId: number };
  itemPickup:    { player: PlayerServer; itemId: number; quantity: number };
  chatMessage:   { player: PlayerServer; scope: ChatScope; message: string };
  beforeDamage:  { attacker: CombatTarget; target: CombatTarget; damage: { value: number } };
  customAction:  { player: PlayerServer; channel: string; payload: unknown };
};

type Handler<K extends keyof HookMap> = (payload: HookMap[K]) => void;

const registry = new Map<keyof HookMap, Set<Handler<any>>>();

export function on<K extends keyof HookMap>(event: K, handler: Handler<K>): () => void {
  let set = registry.get(event);
  if (!set) {
    set = new Set();
    registry.set(event, set);
  }
  set.add(handler);
  return () => { set!.delete(handler); };
}

export function off<K extends keyof HookMap>(event: K, handler: Handler<K>): void {
  registry.get(event)?.delete(handler);
}

export function emit<K extends keyof HookMap>(event: K, payload: HookMap[K]): void {
  const set = registry.get(event);
  if (!set) return;
  // A throwing or rejecting handler must never break the game loop or
  // stop sibling handlers. Isolate both sync throws and async rejections.
  for (const handler of set) {
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
