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
  registry.get(event)?.forEach((h) => h(payload));
}

export function clearAll(): void {
  registry.clear();
}
