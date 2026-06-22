import { describe, it, expect, beforeEach } from 'vitest';
import { handleInteract, findInteractTarget } from './interactionService.js';
import { on, clearAll } from '../engine/hooks.js';
import { createFixture, tile } from '../sim/simFixture.js';
import { Direction } from '../../shared/types.js';

beforeEach(() => clearAll());

describe('findInteractTarget', () => {
  it('returns the NPC the player is facing within one tile', () => {
    const sim = createFixture(0);
    const npc = sim.addNpc({
      behavior: 'shopkeeper',
      position: tile(6, 5),
      health: 10,
    });
    const player = sim.addPlayer({
      name: 'Alice',
      position: tile(5, 5),
      direction: Direction.Right,
    });
    sim.step(1); // build the spatial index

    expect(findInteractTarget(player, sim.map)?.id).toBe(npc.id);
  });

  it('returns undefined when facing away from the NPC', () => {
    const sim = createFixture(0);
    sim.addNpc({ behavior: 'shopkeeper', position: tile(6, 5), health: 10 });
    const player = sim.addPlayer({
      name: 'Alice',
      position: tile(5, 5),
      direction: Direction.Left,
    });
    sim.step(1);

    expect(findInteractTarget(player, sim.map)).toBeUndefined();
  });

  it('ignores dead NPCs', () => {
    const sim = createFixture(0);
    sim.addNpc({ behavior: 'shopkeeper', position: tile(6, 5), health: 0 });
    const player = sim.addPlayer({
      name: 'Alice',
      position: tile(5, 5),
      direction: Direction.Right,
    });
    sim.step(1);

    expect(findInteractTarget(player, sim.map)).toBeUndefined();
  });
});

describe('handleInteract', () => {
  it('emits npcInteract with the faced NPC', () => {
    const sim = createFixture(0);
    const npc = sim.addNpc({
      behavior: 'shopkeeper',
      position: tile(6, 5),
      health: 10,
    });
    const player = sim.addPlayer({
      name: 'Alice',
      position: tile(5, 5),
      direction: Direction.Right,
    });
    sim.step(1);

    const seen: string[] = [];
    on('npcInteract', ({ player: p, npc: n }) =>
      seen.push(`${p.name}>${n.id}`),
    );

    handleInteract(player);

    expect(seen).toEqual([`Alice>${npc.id}`]);
  });

  it('does nothing when no NPC is faced', () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({
      name: 'Alice',
      position: tile(5, 5),
      direction: Direction.Right,
    });
    sim.step(1);

    let fired = false;
    on('npcInteract', () => {
      fired = true;
    });
    handleInteract(player);

    expect(fired).toBe(false);
  });
});
