/**
 * End to end, with the wiring at each dispatch site: a script attaches a
 * behavior by name, content points at that name, and stepping on, talking
 * to, killing or using the thing runs it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runInSandbox } from './sandbox.js';
import { clearEntityBehaviors } from './entityScripts.js';
import { clearScriptErrors, getScriptErrors } from './scriptErrors.js';
import { clearAll } from '../hooks.js';
import { createFixture, tile } from '../../sim/simFixture.js';
import { rebuildQuadtree } from '../../spatial/spatialManager.js';
import { handleInteract } from '../../services/world/interactionService.js';
import { resolveDamage } from '../../services/combat/index.js';
import { useItem } from '../../services/economy/inventoryService.js';
import { items } from '../../services/world/gameData.js';
import { Direction, Key, type Item } from '../../../shared/types.js';

const calls = vi.hoisted(() => ({ log: [] as unknown[] }));

beforeEach(() => {
  clearAll();
  clearEntityBehaviors();
  clearScriptErrors();
  calls.log = [];
});

/** Runs a script with a `record()` global so it can report what it saw. */
function script(code: string, name = 'behaviors.js') {
  return runInSandbox(code, name, {
    record: (value: unknown) => calls.log.push(value),
  });
}

describe('tile with a script trigger', () => {
  it('runs the attached behavior when a player steps on it', () => {
    const sim = createFixture(0);
    const handle = script(`
      attach('trap', {
        onEnter({ player, tile, map }) {
          record({ player: player.name, tileIndex: tile.tileIndex, map: map.id });
        },
      });
    `);

    sim.map.tiles[2]![2] = {
      tileIndex: 9,
      triggers: [{ action: 'script', scriptId: 'trap' }],
    };
    const player = sim.addPlayer({ name: 'Alice', position: tile(2, 1) });
    rebuildQuadtree(sim.mapId, sim.map);

    sim.press('Alice', Key.ArrowDown);
    sim.step();

    expect(calls.log).toEqual([
      { player: 'Alice', tileIndex: 9, map: sim.mapId },
    ]);
    expect(player.position).toEqual(tile(2, 2));

    handle.cleanup();
  });

  it('leaves the other trigger actions working', () => {
    const sim = createFixture(0);
    const handle = script(
      `attach('trap', { onEnter() { record('script'); } });`,
    );

    sim.map.tiles[2]![2] = {
      tileIndex: 0,
      triggers: [{ action: 'heal' }, { action: 'script', scriptId: 'trap' }],
    };
    const player = sim.addPlayer({
      name: 'Alice',
      position: tile(2, 1),
      health: 10,
      maxHealth: 100,
    });
    rebuildQuadtree(sim.mapId, sim.map);

    sim.press('Alice', Key.ArrowDown);
    sim.step();

    expect(player.health).toBe(100);
    expect(calls.log).toEqual(['script']);

    handle.cleanup();
  });

  it('does not break the tick when the trigger names nothing', () => {
    const sim = createFixture(0);
    sim.map.tiles[2]![2] = {
      tileIndex: 0,
      triggers: [{ action: 'script', scriptId: 'never-registered' }],
    };
    const player = sim.addPlayer({ name: 'Alice', position: tile(2, 1) });
    rebuildQuadtree(sim.mapId, sim.map);

    sim.press('Alice', Key.ArrowDown);
    expect(() => sim.step()).not.toThrow();
    expect(player.position).toEqual(tile(2, 2));
  });
});

describe('npc with a behavior', () => {
  it('runs onInteract when a player talks to it', () => {
    const sim = createFixture(0);
    const handle = script(`
      attach('sage', {
        onInteract({ player, npc }) { record(player.name + ' -> ' + npc.name); },
      });
    `);

    const player = sim.addPlayer({ name: 'Alice', position: tile(2, 2) });
    player.direction = Direction.Right;
    sim.addNpc({
      id: 'sage1',
      name: 'Sage',
      position: tile(3, 2),
      scriptId: 'sage',
    });
    rebuildQuadtree(sim.mapId, sim.map);

    handleInteract(player);

    expect(calls.log).toEqual(['Alice -> Sage']);

    handle.cleanup();
  });

  it('ignores an npc with no behavior attached', () => {
    const sim = createFixture(0);
    const handle = script(
      `attach('sage', { onInteract() { record('ran'); } });`,
    );

    const player = sim.addPlayer({ name: 'Alice', position: tile(2, 2) });
    player.direction = Direction.Right;
    sim.addNpc({ id: 'plain', name: 'Plain', position: tile(3, 2) });
    rebuildQuadtree(sim.mapId, sim.map);

    handleInteract(player);

    expect(calls.log).toEqual([]);

    handle.cleanup();
  });

  it('runs onDeath when the npc is killed', async () => {
    const sim = createFixture(0);
    const handle = script(`
      attach('boss', {
        onDeath({ npc, killer }) { record(npc.name + ' killed by ' + killer.name); },
      });
    `);

    const player = sim.addPlayer({ name: 'Alice', position: tile(2, 2) });
    const npc = sim.addNpc({
      id: 'boss1',
      name: 'Boss',
      position: tile(3, 2),
      scriptId: 'boss',
      health: 5,
      maxHealth: 5,
    });
    rebuildQuadtree(sim.mapId, sim.map);

    await resolveDamage(npc, 999, { attacker: player, map: sim.map });

    expect(calls.log).toEqual(['Boss killed by Alice']);

    handle.cleanup();
  });
});

describe('item with a behavior', () => {
  it('runs onUse when a player consumes it', async () => {
    const sim = createFixture(0);
    const handle = script(`
      attach('scroll', {
        onUse({ player, item }) { record(player.name + ' used ' + item.name); },
      });
    `);

    items.set(1, {
      id: 1,
      name: 'Scroll',
      sprite: 0,
      type: 'consumable',
      scriptId: 'scroll',
    } as Item);
    sim.addPlayer({
      name: 'Alice',
      inventory: { items: [{ item: 1, quantity: 1 }], maxCapacity: 10 },
    });

    await useItem('Alice', 1);

    expect(calls.log).toEqual(['Alice used Scroll']);

    handle.cleanup();
  });
});

describe('reloading the script', () => {
  it('drops the old behavior so a stale one cannot keep firing', () => {
    const sim = createFixture(0);
    const first = script(`attach('trap', { onEnter() { record('v1'); } });`);

    sim.map.tiles[2]![2] = {
      tileIndex: 0,
      triggers: [{ action: 'script', scriptId: 'trap' }],
    };
    sim.addPlayer({ name: 'Alice', position: tile(2, 1) });
    rebuildQuadtree(sim.mapId, sim.map);

    // What the loader does on a file change.
    first.cleanup();
    const second = script(`attach('trap', { onEnter() { record('v2'); } });`);

    sim.press('Alice', Key.ArrowDown);
    sim.step();

    expect(calls.log).toEqual(['v2']);

    second.cleanup();
  });
});

describe('a behavior that throws', () => {
  it('is isolated and reported with its line, like a hook handler', () => {
    const sim = createFixture(0);
    const handle = script(
      [
        `attach('trap', {`,
        `  onEnter() { throw new Error('bad trap'); },`,
        `});`,
      ].join('\n'),
      'traps.js',
    );

    sim.map.tiles[2]![2] = {
      tileIndex: 0,
      triggers: [{ action: 'script', scriptId: 'trap' }],
    };
    const player = sim.addPlayer({ name: 'Alice', position: tile(2, 1) });
    rebuildQuadtree(sim.mapId, sim.map);

    sim.press('Alice', Key.ArrowDown);
    expect(() => sim.step()).not.toThrow();
    // The player still moved: a broken behavior does not eat the tick.
    expect(player.position).toEqual(tile(2, 2));

    expect(getScriptErrors('traps.js')[0]).toMatchObject({
      source: 'behavior',
      context: 'trap.onEnter',
      line: 2,
    });

    handle.cleanup();
  });
});
