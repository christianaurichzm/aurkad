/**
 * End to end, with the wiring at each dispatch site: a script attaches a
 * behavior by name, content points at that name, and stepping on, talking
 * to, killing or using the thing runs it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runInSandbox } from './sandbox.js';
import { clearEntityBehaviors } from './entityScripts.js';
import { clearScriptErrors, getScriptErrors } from './scriptErrors.js';
import { clearHandlerBudget, isHandlerDisabled } from './handlerBudget.js';
import { config } from '../../config.js';
import { clearAll } from '../hooks.js';
import { createFixture, tile } from '../../sim/simFixture.js';
import { rebuildQuadtree } from '../../sim/spatialManager.js';
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
  clearHandlerBudget();
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

  it('runs onDeath when the npc is killed', () => {
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

    resolveDamage(npc, 999, { attacker: player, map: sim.map });

    expect(calls.log).toEqual(['Boss killed by Alice']);

    handle.cleanup();
  });
});

describe('item with a behavior', () => {
  it('runs onUse when a player consumes it', () => {
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

    useItem('Alice', 1);

    expect(calls.log).toEqual(['Alice used Scroll']);

    handle.cleanup();
  });

  it('keeps an item whose behavior refuses the use, effects and all', () => {
    const sim = createFixture(0);
    const handle = script(`
      attach('sealed', { onUse({ refuse }) { refuse(); } });
      on('itemUse', () => record('itemUse'));
    `);

    items.set(1, {
      id: 1,
      name: 'Sealed potion',
      sprite: 0,
      type: 'consumable',
      scriptId: 'sealed',
      effects: [{ attribute: 'health', type: 'add', value: 50 }],
    } as Item);
    const alice = sim.addPlayer({
      name: 'Alice',
      health: 10,
      inventory: { items: [{ item: 1, quantity: 1 }], maxCapacity: 10 },
    });

    expect(useItem('Alice', 1)).toBe(false);

    expect(alice.inventory.items).toEqual([{ item: 1, quantity: 1 }]);
    expect(alice.health).toBe(10);
    expect(calls.log).toEqual([]);

    handle.cleanup();
  });

  it('runs onEquip and onUnequip when a player puts equipment on and takes it off', () => {
    const sim = createFixture(0);
    const handle = script(`
      attach('crown', {
        onEquip({ player, item, slot }) { record('on ' + item.name + ' ' + slot); },
        onUnequip({ player, item, slot }) { record('off ' + item.name + ' ' + slot); },
      });
    `);

    items.set(2, {
      id: 2,
      name: 'Crown',
      sprite: 0,
      type: 'helmet',
      scriptId: 'crown',
    } as Item);
    const player = sim.addPlayer({
      name: 'Alice',
      inventory: { items: [{ item: 2, quantity: 1 }], maxCapacity: 10 },
    });

    useItem('Alice', 2);
    expect(player.equipped.helmet).toBe(2);

    useItem('Alice', 2);
    expect(player.equipped.helmet).toBeUndefined();

    expect(calls.log).toEqual(['on Crown helmet', 'off Crown helmet']);

    handle.cleanup();
  });

  // What onEquip grants, onUnequip takes back, so a handler that only sees one
  // side of a swap leaves the bonus of a piece the player is no longer wearing.
  it('runs the old item onUnequip before the new item onEquip on a swap', () => {
    const sim = createFixture(0);
    const handle = script(`
      attach('crown', {
        params: { power: { type: 'number', default: 0 } },
        onEquip({ item, params }) { record('+' + item.name + ':' + params.power); },
        onUnequip({ item, params }) { record('-' + item.name + ':' + params.power); },
      });
    `);

    items.set(2, {
      id: 2,
      name: 'Old',
      description: '',
      sprite: 0,
      type: 'helmet',
      scriptId: 'crown',
      scriptParams: { power: 1 },
    });
    items.set(3, {
      id: 3,
      name: 'New',
      description: '',
      sprite: 0,
      type: 'helmet',
      scriptId: 'crown',
      scriptParams: { power: 5 },
    });
    sim.addPlayer({
      name: 'Alice',
      inventory: { items: [{ item: 3, quantity: 1 }], maxCapacity: 10 },
      equipped: { helmet: 2 },
    });

    useItem('Alice', 3);

    expect(calls.log).toEqual(['-Old:1', '+New:5']);

    handle.cleanup();
  });

  // A consumable reaches onUse and equipment does not: the same field on the
  // item means different events, and mixing them would make every handler
  // branch on the item type it was already attached to.
  it('does not run onUse for equipment', () => {
    const sim = createFixture(0);
    const handle = script(`
      attach('crown', { onUse() { record('used'); } });
    `);

    items.set(2, {
      id: 2,
      name: 'Crown',
      sprite: 0,
      type: 'helmet',
      scriptId: 'crown',
    } as Item);
    sim.addPlayer({
      name: 'Alice',
      inventory: { items: [{ item: 2, quantity: 1 }], maxCapacity: 10 },
    });

    useItem('Alice', 2);

    expect(calls.log).toEqual([]);

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

// The payoff of declaring params: two pieces of content share one behavior and
// differ only in what the designer filled in.
describe('exported params', () => {
  it('gives each tile its own configuration of one behavior', () => {
    const sim = createFixture(0);
    const handle = script(`
      attach('chest', {
        params: {
          itemId: { type: 'item', required: true },
          quantity: { type: 'number', default: 1 },
          message: { type: 'text', default: 'nothing special' },
        },
        onEnter({ params }) { record(params); },
      });
    `);

    sim.map.tiles[2]![2] = {
      tileIndex: 0,
      triggers: [
        {
          action: 'script',
          scriptId: 'chest',
          scriptParams: { itemId: 5, quantity: 3, message: 'A sword!' },
        },
      ],
    };
    sim.map.tiles[3]![2] = {
      tileIndex: 0,
      triggers: [
        { action: 'script', scriptId: 'chest', scriptParams: { itemId: 9 } },
      ],
    };
    sim.addPlayer({ name: 'Alice', position: tile(2, 1) });
    rebuildQuadtree(sim.mapId, sim.map);

    // Walks over both tiles with the key held down.
    sim.press('Alice', Key.ArrowDown);
    sim.step(20);

    expect(calls.log).toEqual([
      { itemId: 5, quantity: 3, message: 'A sword!' },
      // The second tile filled in only the required field, so the declared
      // defaults cover the rest.
      { itemId: 9, quantity: 1, message: 'nothing special' },
    ]);

    handle.cleanup();
  });

  it('passes an item behavior the values stored on the item', () => {
    const sim = createFixture(0);
    const handle = script(`
      attach('scroll', {
        params: { mapId: { type: 'map' }, col: { type: 'number' } },
        onUse({ params }) { record(params.mapId + ':' + params.col); },
      });
    `);

    const scroll: Item = {
      id: 1,
      name: 'Scroll',
      description: '',
      sprite: 0,
      type: 'consumable',
      scriptId: 'scroll',
      scriptParams: { mapId: 'town', col: 9 },
    };
    items.set(1, scroll);
    sim.addPlayer({
      name: 'Alice',
      inventory: { items: [{ item: 1, quantity: 1 }], maxCapacity: 10 },
    });

    useItem('Alice', 1);

    expect(calls.log).toEqual(['town:9']);

    handle.cleanup();
  });

  // Loud where a script author will see it, rather than a field that never
  // appears in the editor and a param that reads undefined at runtime.
  it('reports a malformed declaration as a load error, with its line', () => {
    createFixture(0);
    script(
      [
        `attach('chest', {`,
        `  params: { itemId: { type: 'sprite' } },`,
        `  onEnter() {},`,
        `});`,
      ].join('\n'),
      'chest.js',
    );

    expect(getScriptErrors('chest.js')[0]).toMatchObject({
      source: 'load',
      line: 1,
    });
    expect(getScriptErrors('chest.js')[0]?.message).toContain('unknown type');
  });
});

// A handler that returns slowly is measured and eventually dropped. One
// that never returns cannot be caught inside this single-threaded process,
// which is why the budget measures instead of preventing.
describe('the time budget on a handler', () => {
  it('stops running an attached behavior that keeps overrunning', () => {
    const sim = createFixture(0);
    const budgetMs = config.scripting.handlerBudgetMs;
    const handle = script(
      `
      attach('slow', {
        onEnter() {
          const until = Date.now() + ${budgetMs + 5};
          while (Date.now() < until) {}
          record('ran');
        },
      });
    `,
      'slow.js',
    );

    sim.map.tiles[2]![2] = {
      tileIndex: 0,
      triggers: [{ action: 'script', scriptId: 'slow' }],
    };
    const player = sim.addPlayer({ name: 'Alice', position: tile(2, 1) });
    rebuildQuadtree(sim.mapId, sim.map);

    // Step on and off the tile until the strikes run out, plus one more.
    for (let i = 0; i < config.scripting.handlerBudgetStrikes + 1; i++) {
      player.position = tile(2, 1);
      player.moving = false;
      sim.press('Alice', Key.ArrowDown);
      sim.step();
      sim.release('Alice', Key.ArrowDown);
      sim.step();
    }

    expect(calls.log.length).toBe(config.scripting.handlerBudgetStrikes);
    expect(isHandlerDisabled('slow.js', 'slow.onEnter')).toBe(true);
    // And the file carries the reason, where the editor shows it.
    expect(getScriptErrors('slow.js')[0]).toMatchObject({ source: 'budget' });

    handle.cleanup();
  });
});
