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
import { npcMoveTicks, respawnNpc } from './index.js';
import { gameConfig } from '../../gameConfig.js';
import { resolveDamage } from '../combat/index.js';
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
    const npc = sim.addNpc({
      position: tile(2, 2),
      direction: Direction.Right,
    });
    const player = sim.addPlayer({ position: tile(3, 2) });
    expect(isPlayerInAttackRange(npc, player)).toBe(true);
  });

  it('returns true when player is directly above (Up)', () => {
    const npc = sim.addNpc({ position: tile(5, 5), direction: Direction.Up });
    const player = sim.addPlayer({ position: tile(5, 4) });
    expect(isPlayerInAttackRange(npc, player)).toBe(true);
  });

  it('returns false when player is behind the npc', () => {
    const npc = sim.addNpc({
      position: tile(5, 5),
      direction: Direction.Right,
    });
    const player = sim.addPlayer({ position: tile(4, 5) });
    expect(isPlayerInAttackRange(npc, player)).toBe(false);
  });

  it('returns false when player is out of range', () => {
    const npc = sim.addNpc({
      position: tile(0, 0),
      direction: Direction.Right,
    });
    const player = sim.addPlayer({ position: tile(5, 0) });
    expect(isPlayerInAttackRange(npc, player)).toBe(false);
  });

  it('returns false when player is perpendicular and outside hitbox width', () => {
    const npc = sim.addNpc({ position: tile(5, 5), direction: Direction.Down });
    // Below but too far to the side
    const player = sim.addPlayer({
      position: { x: tile(5, 6).x + TILE_SIZE * 2, y: tile(5, 6).y },
    });
    expect(isPlayerInAttackRange(npc, player)).toBe(false);
  });
});

// stepNpcToward (the move primitive behind moveNpcToward)

describe('stepNpcToward', () => {
  it('moves one tile toward the target and faces it', () => {
    const npc = sim.addNpc({ position: tile(5, 5), direction: Direction.Down });
    stepNpcToward(npc, { position: tile(9, 5) }, sim.map);
    expect(npc.position).toEqual(tile(6, 5));
    expect(npc.direction).toBe(Direction.Right);
    expect(npc.action).toBe(CharacterAction.Walk);
  });

  it('steps along the dominant axis (vertical)', () => {
    const npc = sim.addNpc({ position: tile(5, 5) });
    stepNpcToward(npc, { position: tile(5, 9) }, sim.map);
    expect(npc.position).toEqual(tile(5, 6));
    expect(npc.direction).toBe(Direction.Down);
  });

  it('does not move through a blocked tile', () => {
    sim.map.tiles[5]![6]!.blocked = true; // wall to the right
    const npc = sim.addNpc({ position: tile(5, 5), direction: Direction.Down });
    stepNpcToward(npc, { position: tile(9, 5) }, sim.map);
    // BFS finds the detour below the wall instead of going through it.
    expect(npc.position).not.toEqual(tile(6, 5));
    expect(npc.position).toEqual(tile(5, 6));
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
    const player = sim.addPlayer({
      name: 'Target',
      health: 100,
      position: tile(6, 5),
    });

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
    const player = sim.addPlayer({
      name: 'Target',
      health: 100,
      position: tile(6, 5),
    });

    sim.step(1);

    expect(player.health).toBe(100);
  });

  it('hostile NPC wanders when player is outside notice radius', () => {
    const npc = sim.addNpc({ behavior: 'hostile', position: tile(5, 5) });
    // tile(12,5) is 7 tiles away, beyond the 4-tile notice radius
    sim.addPlayer({ name: 'Target', position: tile(12, 5) });

    const before = { ...npc.position };
    sim.step(3);

    // Wander is random so position may or may not change, but the NPC must
    // not have moved consistently toward the player (greedy chase).
    const distAfter =
      Math.abs(npc.position.x - tile(12, 5).x) +
      Math.abs(npc.position.y - tile(12, 5).y);
    expect(distAfter).toBeGreaterThan(3 * TILE_SIZE);
    void before; // position is non-deterministic when wandering
  });

  it('hostile NPC chases player within notice radius', () => {
    const npc = sim.addNpc({ behavior: 'hostile', position: tile(5, 5) });
    // tile(8,5) is 3 tiles = 192px, within the 4-tile (256px) notice radius
    const player = sim.addPlayer({ name: 'Target', position: tile(8, 5) });

    sim.step(3);

    const dist =
      Math.abs(npc.position.x - player.position.x) +
      Math.abs(npc.position.y - player.position.y);
    // After 3 chase steps the NPC should be adjacent to the player (1 tile)
    expect(dist).toBeLessThanOrEqual(TILE_SIZE);
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
    const npc = sim.addNpc({
      id: 'goblin',
      behavior: 'aggressive',
      maxHealth: 30,
      health: 1,
    });
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

  it('keeps an npc with respawnMs off the map until its time is up', () => {
    const npc = sim.addNpc({
      id: 'goblin',
      maxHealth: 30,
      health: 0,
      position: tile(6, 6),
      respawnMs: 1000,
    });
    sim.map.tiles[3]![3]!.npcSpawn = npc.id;

    respawnNpc(sim.mapId, npc);
    expect(sim.map.npcs[npc.id]).toBeUndefined();

    sim.step(msToTicks(1000) - 1);
    expect(sim.map.npcs[npc.id]).toBeUndefined();

    sim.step(1);
    expect(sim.map.npcs[npc.id]).toBe(npc);
    expect(npc.health).toBe(30);
    expect(npc.position).toEqual(tile(3, 3));
  });

  it('leaves the rebuilt npc alone when the map was reloaded meanwhile', () => {
    const npc = sim.addNpc({ id: 'goblin', maxHealth: 30, respawnMs: 1000 });
    sim.map.tiles[3]![3]!.npcSpawn = npc.id;

    respawnNpc(sim.mapId, npc);
    const rebuilt = sim.addNpc({ id: 'goblin', maxHealth: 30 });
    sim.step(msToTicks(1000));

    expect(sim.map.npcs[npc.id]).toBe(rebuilt);
  });
});

// retaliation, leash and the walk home

describe('aggro and leash', () => {
  it('a hostile npc answers a hit struck from outside its notice radius', () => {
    const npc = sim.addNpc({ behavior: 'hostile', position: tile(5, 5) });
    const archer = sim.addPlayer({ name: 'Archer', position: tile(5, 11) });

    // Six tiles: past the four it notices on its own, inside the six an arrow
    // flies. Left alone it never comes.
    sim.step(1);
    expect(getOrInitNpcAi(npc).state).toBe('wander');

    resolveDamage(npc, 1, { attacker: archer });
    sim.step(1);

    expect(getOrInitNpcAi(npc).state).toBe('chase');
    expect(npc.position.y).toBeGreaterThan(5 * TILE_SIZE);
  });

  it('walks back to its post once the target is gone', () => {
    const npc = sim.addNpc({ behavior: 'aggressive', position: tile(5, 5) });
    const bait = sim.addPlayer({ name: 'Bait', position: tile(9, 5) });

    sim.step(2);
    expect(npc.position).not.toEqual(tile(5, 5));

    bait.health = 0;
    sim.step(6);

    expect(npc.position).toEqual(tile(5, 5));
    expect(getOrInitNpcAi(npc).state).toBe('idle');
  });

  it('gives up at the leash and stays deaf on the way back', () => {
    const npc = sim.addNpc({
      behavior: 'aggressive',
      position: tile(5, 5),
      leash: 2,
    });
    const kiter = sim.addPlayer({ name: 'Kiter', position: tile(12, 5) });

    sim.step(2);
    expect(npc.position).toEqual(tile(7, 5));

    // Two tiles from home is the end of the rope: it turns around.
    sim.step(1);
    expect(getOrInitNpcAi(npc).state).toBe('return');

    // A hit now must not pull it out again, or the leash buys nothing.
    resolveDamage(npc, 1, { attacker: kiter });
    sim.step(1);

    expect(getOrInitNpcAi(npc).state).toBe('return');
    expect(npc.position).toEqual(tile(5, 5));
  });

  it('sight on the npc widens what it notices on its own', () => {
    const npc = sim.addNpc({
      behavior: 'hostile',
      position: tile(5, 5),
      sight: 8,
    });
    sim.addPlayer({ name: 'Seen', position: tile(5, 11) });

    sim.step(1);

    expect(getOrInitNpcAi(npc).state).toBe('chase');
  });
});

// pathDepth: how clever the chase is

describe('path depth', () => {
  // Walls on three sides, opening to the left: the shape a greedy chase cannot
  // leave, because every step that helps points away from the target.
  const buildDeadEnd = () => {
    for (let col = 6; col <= 9; col++) {
      sim.map.tiles[4]![col]!.blocked = true;
      sim.map.tiles[8]![col]!.blocked = true;
    }
    for (let row = 4; row <= 8; row++) sim.map.tiles[row]![9]!.blocked = true;
  };

  it('finds the way out of a dead end', () => {
    buildDeadEnd();
    const npc = sim.addNpc({ position: tile(7, 6) });

    for (let i = 0; i < 14; i++) {
      stepNpcToward(npc, { position: tile(12, 6) }, sim.map);
    }

    expect(npc.position.x).toBeGreaterThan(9 * TILE_SIZE);
  });

  it('pathDepth 0 stays trapped in the same dead end', () => {
    buildDeadEnd();
    const npc = sim.addNpc({ position: tile(7, 6), pathDepth: 0 });

    for (let i = 0; i < 14; i++) {
      stepNpcToward(npc, { position: tile(12, 6) }, sim.map);
    }

    expect(npc.position.x).toBeLessThanOrEqual(8 * TILE_SIZE);
  });

  it('pathDepth 0 walks into a wall instead of around it', () => {
    sim.map.tiles[5]![6]!.blocked = true;
    const npc = sim.addNpc({ position: tile(5, 5), pathDepth: 0 });

    stepNpcToward(npc, { position: tile(9, 5) }, sim.map);

    expect(npc.position).toEqual(tile(5, 5));
    expect(npc.action).toBe(CharacterAction.Idle);
  });
});

// speed, which is the one ai number measured in time rather than tiles

describe('npcMoveTicks', () => {
  it('falls back to the game-wide interval', () => {
    const npc = sim.addNpc();
    expect(npcMoveTicks(npc)).toBe(
      msToTicks(gameConfig.combat.npcUpdateIntervalMs),
    );
  });

  it('takes the interval from the npc when it declares one', () => {
    expect(npcMoveTicks(sim.addNpc({ moveIntervalMs: 250 }))).toBe(5);
  });

  // A step cannot happen between ticks, so anything under one tick is one
  // tick, and a 0 would divide by zero in the caller's modulo.
  it('never asks for less than a whole tick', () => {
    expect(npcMoveTicks(sim.addNpc({ moveIntervalMs: 50 }))).toBe(1);
    expect(npcMoveTicks(sim.addNpc({ moveIntervalMs: 1 }))).toBe(1);
  });

  it('rounds up, so an interval is never shorter than asked', () => {
    expect(npcMoveTicks(sim.addNpc({ moveIntervalMs: 120 }))).toBe(3);
  });
});
