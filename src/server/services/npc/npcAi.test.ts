import { describe, it, expect, beforeEach } from 'vitest';
import { CharacterAction, Direction } from '../../../shared/types.js';
import { createFixture, tile } from '../../sim/simFixture.js';
import { msToTicks } from '../../sim/clock.js';
import { getOrInitNpcAi, resetNpcAi, transitionNpcAi } from './aiBrain.js';
import {
  calculateDirection,
  isPlayerInAttackRange,
  stepNpcToward,
} from './behaviors.js';
import { respawnNpc } from './index.js';
import { TILE_SIZE } from '../../../shared/constants.js';

let sim: ReturnType<typeof createFixture>;

beforeEach(() => {
  sim = createFixture(0);
});

// aiBrain

describe('aiBrain', () => {
  it('initialises to idle on first access', () => {
    const npc = sim.addNpc();
    const ai = getOrInitNpcAi(npc);
    expect(ai.state).toBe('idle');
    expect(ai.lastAttackTick).toBe(0);
  });

  it('returns the same state object on repeated calls', () => {
    const npc = sim.addNpc();
    expect(getOrInitNpcAi(npc)).toBe(getOrInitNpcAi(npc));
  });

  it('transitions state and updates lastStateChangeTick', () => {
    const npc = sim.addNpc();
    const ai = getOrInitNpcAi(npc);
    sim.step(3);
    transitionNpcAi(ai, 'chase');
    expect(ai.state).toBe('chase');
    expect(ai.lastStateChangeTick).toBe(3);
  });

  it('is a noop when transitioning to the same state', () => {
    const npc = sim.addNpc();
    const ai = getOrInitNpcAi(npc);
    const tick = ai.lastStateChangeTick;
    sim.step(2);
    transitionNpcAi(ai, 'idle');
    expect(ai.lastStateChangeTick).toBe(tick);
  });

  it('resetNpcAi clears state so next call re-initialises to idle', () => {
    const npc = sim.addNpc();
    const ai = getOrInitNpcAi(npc);
    transitionNpcAi(ai, 'chase');
    resetNpcAi(npc);
    expect(getOrInitNpcAi(npc).state).toBe('idle');
  });

  it('two npcs on different maps have independent ai states', () => {
    const map2 = sim.addMap({ id: 'map2' });
    const npc1 = sim.addNpc({ id: 'n1' });
    const npc2 = { ...sim.addNpc({ id: 'n2' }), mapId: map2.id };
    map2.npcs[npc2.id] = npc2;

    const ai1 = getOrInitNpcAi(npc1);
    transitionNpcAi(ai1, 'chase');

    expect(ai1.state).toBe('chase');
    expect(getOrInitNpcAi(npc2).state).toBe('idle');
  });
});

// calculateDirection

describe('calculateDirection', () => {
  it('computes correct deltas and squared distance', () => {
    const { dx, dy, distanceSq } = calculateDirection(
      { position: { x: 0, y: 0 } },
      { position: { x: 3, y: 4 } },
    );
    expect(dx).toBe(3);
    expect(dy).toBe(4);
    expect(distanceSq).toBe(25);
  });

  it('negative deltas when target is above-left', () => {
    const { dx, dy } = calculateDirection(
      { position: { x: 5, y: 5 } },
      { position: { x: 2, y: 1 } },
    );
    expect(dx).toBe(-3);
    expect(dy).toBe(-4);
  });

  it('zero distance when positions are equal', () => {
    const pos = { position: { x: 10, y: 10 } };
    expect(calculateDirection(pos, pos).distanceSq).toBe(0);
  });
});

// isPlayerInAttackRange

describe('isPlayerInAttackRange', () => {
  it('returns true when player is directly in front (Right)', () => {
    const npc = sim.addNpc({ position: tile(2, 2), direction: Direction.Right });
    const player = sim.addPlayer({ position: tile(3, 2) });
    expect(isPlayerInAttackRange(npc, player)).toBe(true);
  });

  it('returns true when player is directly above (Up)', () => {
    const npc = sim.addNpc({ position: tile(5, 5), direction: Direction.Up });
    const player = sim.addPlayer({ position: tile(5, 4) });
    expect(isPlayerInAttackRange(npc, player)).toBe(true);
  });

  it('returns false when player is behind the npc', () => {
    const npc = sim.addNpc({ position: tile(5, 5), direction: Direction.Right });
    const player = sim.addPlayer({ position: tile(4, 5) });
    expect(isPlayerInAttackRange(npc, player)).toBe(false);
  });

  it('returns false when player is out of range', () => {
    const npc = sim.addNpc({ position: tile(0, 0), direction: Direction.Right });
    const player = sim.addPlayer({ position: tile(5, 0) });
    expect(isPlayerInAttackRange(npc, player)).toBe(false);
  });

  it('returns false when player is perpendicular and outside hitbox width', () => {
    const npc = sim.addNpc({ position: tile(5, 5), direction: Direction.Down });
    // Below but too far to the side
    const player = sim.addPlayer({ position: { x: tile(5, 6).x + TILE_SIZE * 2, y: tile(5, 6).y } });
    expect(isPlayerInAttackRange(npc, player)).toBe(false);
  });
});

// stepNpcToward (the move primitive behind moveNpcToward)

describe('stepNpcToward', () => {
  it('moves one tile toward the target and faces it', () => {
    const npc = sim.addNpc({ position: tile(5, 5), direction: Direction.Down });
    stepNpcToward(npc, { position: tile(9, 5) });
    expect(npc.position).toEqual(tile(6, 5));
    expect(npc.direction).toBe(Direction.Right);
    expect(npc.action).toBe(CharacterAction.Walk);
  });

  it('steps along the dominant axis (vertical)', () => {
    const npc = sim.addNpc({ position: tile(5, 5) });
    stepNpcToward(npc, { position: tile(5, 9) });
    expect(npc.position).toEqual(tile(5, 6));
    expect(npc.direction).toBe(Direction.Down);
  });

  it('does not move through a blocked tile', () => {
    sim.map.tiles[5]![6]!.blocked = true; // wall to the right
    const npc = sim.addNpc({ position: tile(5, 5), direction: Direction.Down });
    stepNpcToward(npc, { position: tile(9, 5) });
    expect(npc.position).toEqual(tile(5, 5)); // stayed put, didn't phase through
  });
});

// updateNpcs: behaviour via fixture

describe('updateNpcs', () => {
  it('aggressive NPC chases the closest player', () => {
    const npc = sim.addNpc({ behavior: 'aggressive', position: tile(5, 5) });
    sim.addPlayer({ name: 'Target', position: tile(8, 5) });

    const before = { ...npc.position };
    sim.step(1);

    expect(npc.position).not.toEqual(before);
    expect(npc.action).toBe(CharacterAction.Walk);
  });

  it('aggressive NPC attacks player in range after cooldown expires', () => {
    sim.addNpc({
      behavior: 'aggressive',
      attack: 5,
      position: tile(5, 5),
      direction: Direction.Right,
    });
    const player = sim.addPlayer({ name: 'Target', health: 100, position: tile(6, 5) });

    sim.step(msToTicks(900));

    expect(player.health).toBeLessThan(100);
  });

  it('aggressive NPC does not attack before cooldown expires', () => {
    sim.addNpc({
      behavior: 'aggressive',
      attack: 5,
      position: tile(5, 5),
      direction: Direction.Right,
    });
    const player = sim.addPlayer({ name: 'Target', health: 100, position: tile(6, 5) });

    sim.step(1);

    expect(player.health).toBe(100);
  });

  it('hostile NPC wanders instead of chasing', () => {
    const npc = sim.addNpc({ behavior: 'hostile', position: tile(5, 5) });
    sim.addPlayer({ name: 'Target', position: tile(12, 5) });

    sim.step(1);

    expect([CharacterAction.Walk, CharacterAction.Idle]).toContain(npc.action);
  });

  it('neutral NPC stays idle regardless of nearby players', () => {
    const npc = sim.addNpc({ behavior: 'neutral', position: tile(5, 5) });
    sim.addPlayer({ name: 'Target', position: tile(6, 5) });

    const before = { ...npc.position };
    sim.step(1);

    expect(npc.action).toBe(CharacterAction.Idle);
    expect(npc.position).toEqual(before);
  });

  it('friendly NPC stays idle', () => {
    const npc = sim.addNpc({ behavior: 'friendly' });
    sim.addPlayer({ name: 'Target' });
    sim.step(1);
    expect(npc.action).toBe(CharacterAction.Idle);
  });

  it('shopkeeper NPC stays idle', () => {
    const npc = sim.addNpc({ behavior: 'shopkeeper' });
    sim.addPlayer({ name: 'Target' });
    sim.step(1);
    expect(npc.action).toBe(CharacterAction.Idle);
  });

  it('aggressive NPC with no players remains idle', () => {
    const npc = sim.addNpc({ behavior: 'aggressive', position: tile(5, 5) });
    sim.step(1);
    expect(npc.action).toBe(CharacterAction.Idle);
  });
});

// respawnNpc

describe('respawnNpc', () => {
  it('restores health and resets ai state when a spawn tile exists', () => {
    const npc = sim.addNpc({ id: 'goblin', behavior: 'aggressive', maxHealth: 30, health: 1 });
    sim.map.tiles[3]![3]!.npcSpawn = npc.id;

    const ai = getOrInitNpcAi(npc);
    transitionNpcAi(ai, 'chase');

    respawnNpc(sim.mapId, npc);

    expect(npc.health).toBe(30);
    expect(npc.action).toBe(CharacterAction.Idle);
    expect(getOrInitNpcAi(npc).state).toBe('idle');
  });

  it('does nothing when no spawn tile exists for the npc', () => {
    const npc = sim.addNpc({ id: 'ghost', maxHealth: 30, health: 1 });
    respawnNpc(sim.mapId, npc);
    expect(npc.health).toBe(1);
  });
});
