import {
  RuntimeNpc,
  NpcBehavior,
  CharacterAction,
  Direction,
} from '../../../shared/types.js';
import { TILE_SIZE } from '../../../shared/constants.js';
import { getMap, runtimeState } from '../world/gameData.js';
import { forgetReplicatedEntity } from '../../net/snapshot.js';
import { resetNpcAi } from './aiBrain.js';

// Runtime NPC spawning for scripts and modules (pets, summons, event
// bosses). Spawned NPCs live in map.npcs, so the quadtree and serialization
// pick them up, and are not persisted: they vanish on restart.

export interface SpawnNpcOptions {
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

let spawnSeq = 0;

export function spawnNpc(opts: SpawnNpcOptions): RuntimeNpc | undefined {
  const map = getMap(opts.mapId);
  if (!map) return undefined;

  const maxHealth = opts.maxHealth ?? 10;
  const id = `spawn:${++spawnSeq}`;
  const npc: RuntimeNpc = {
    id,
    name: opts.name ?? 'NPC',
    sprite: opts.sprite ?? 0,
    width: TILE_SIZE,
    height: TILE_SIZE,
    maxHealth,
    health: maxHealth,
    attack: opts.attack ?? 0,
    attackRange: opts.attackRange ?? TILE_SIZE,
    behavior: opts.behavior ?? 'neutral',
    mapId: opts.mapId,
    position: { x: opts.col * TILE_SIZE, y: opts.row * TILE_SIZE },
    direction: Direction.Down,
    action: CharacterAction.Idle,
    kind: 'npc',
  };

  map.npcs[id] = npc;
  return npc;
}

// Remove a spawned NPC. Scans maps by id so it works even if the NPC's mapId
// drifted (e.g. a pet that followed its owner across a warp).
export function despawnNpc(npc: { id: string }): void {
  for (const map of Object.values(runtimeState.maps)) {
    const live = map.npcs[npc.id];
    if (!live) continue;

    delete map.npcs[npc.id];
    // Everything keyed by this id has to go with it. Without this a server
    // running pet or summon scripts accumulates a public-state snapshot and an
    // AI state per despawn, for the life of the process. The live object is
    // what gets passed on: the AI key includes mapId, which the caller's
    // `{ id }` does not carry.
    forgetReplicatedEntity(npc.id);
    resetNpcAi(live);
    return;
  }
}
