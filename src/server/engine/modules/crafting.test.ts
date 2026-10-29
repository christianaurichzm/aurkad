// Exercises the real crafting module (modules/crafting) end to end. Above
// all, a bag with no room for the product must keep the materials; written
// as removeItem then giveItem, that robs the player, so it is pinned here as
// well as in the economy funnel underneath.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runInSandbox } from '../scripting/sandbox.js';
import { unloadAllModules } from './moduleLoader.js';
import { loadModulesForTest } from '../../../test/modules.js';
import { useApi, clearProvides } from './registry.js';
import { clearCommands } from '../commands.js';
import { clearAll } from '../hooks.js';
import { drainGameEvents } from '../eventBus.js';
import { handleCustomAction } from '../../services/comms/customEventService.js';
import { createFixture, tile } from '../../sim/simFixture.js';
import { getMap } from '../../sim/world.js';
import { rebuildQuadtree } from '../../sim/spatialManager.js';
import { tileAt } from '../../../shared/mapGeometry.js';
import type { Item, PlayerServer, Recipe } from '../../../shared/types.js';

// Authored recipes live in the content cache the editor writes to; the model
// behind it is mocked so seeding one needs no database.
vi.mock('../../model/Recipe.js', () => ({
  default: {
    findOneAndUpdate: () => Promise.resolve(undefined),
    deleteOne: () => Promise.resolve(undefined),
    find: () => ({ lean: () => ({ exec: () => Promise.resolve([]) }) }),
  },
}));

const { createOrUpdateRecipe, clearRecipeCache } =
  await import('../../services/content/recipeService.js');

interface CraftingApi {
  list: () => Recipe[];
  available: (player: PlayerServer) => Recipe[];
  craft: (player: PlayerServer, recipeId: string) => string;
  define: (recipe: Recipe) => void;
}

const item = (id: number, name: string): Item => ({
  id,
  name,
  description: '',
  sprite: 0,
  type: 'consumable',
});

const sword: Recipe = {
  id: 'steel-sword',
  name: 'Steel Sword',
  inputs: [
    { itemId: 2, quantity: 1 },
    { itemId: 3, quantity: 50 },
  ],
  output: { itemId: 8, quantity: 1 },
};

/** The module reads content through getRecipes(), so seed the cache first. */
async function bootWith(...recipes: Recipe[]): Promise<CraftingApi> {
  unloadAllModules();
  clearAll();
  clearProvides();
  clearRecipeCache();
  for (const recipe of recipes) await createOrUpdateRecipe(recipe);
  loadModulesForTest('crafting');
  return useApi<CraftingApi>('crafting')!;
}

/** A player holding the sword recipe's materials, and the item catalogue. */
function smith(capacity = 10, sim = createFixture(0)) {
  sim.addItem(item(2, 'Hilt'));
  sim.addItem(item(3, 'Iron Ore'));
  sim.addItem(item(8, 'Steel Sword'));
  const player = sim.addPlayer({
    name: 'Alice',
    inventory: {
      items: [
        { item: 2, quantity: 1 },
        { item: 3, quantity: 60 },
      ],
      maxCapacity: capacity,
    },
  });
  return player;
}

const held = (player: PlayerServer, itemId: number) =>
  player.inventory.items.find((slot) => slot.item === itemId)?.quantity ?? 0;

/** Sends Alice's window request and returns what the server pushed back. */
function ask(channel: string, payload?: unknown) {
  drainGameEvents();
  handleCustomAction({ type: 'custom', username: 'Alice', channel, payload });
  return drainGameEvents().filter((e) => e.type === 'customPlayer') as {
    channel: string;
    payload: unknown;
  }[];
}

function benchUnder(player: PlayerServer) {
  tileAt(getMap(player.mapId)!.tiles, player.position)!.triggers = [
    { action: 'script', scriptId: 'workbench' },
  ];
}

beforeEach(() => {
  clearAll();
  clearCommands();
  clearProvides();
  clearRecipeCache();
  drainGameEvents();
});

afterEach(() => {
  unloadAllModules();
  clearAll();
  clearProvides();
});

describe('crafting module', () => {
  it('provides a crafting API', async () => {
    const crafting = await bootWith();
    expect(crafting.craft).toBeTypeOf('function');
    expect(crafting.available).toBeTypeOf('function');
  });

  it('consumes the inputs and hands over the output', async () => {
    const crafting = await bootWith(sword);
    const player = smith();

    expect(crafting.craft(player, 'steel-sword')).toBe('Crafted.');
    expect(held(player, 2)).toBe(0);
    expect(held(player, 3)).toBe(10);
    expect(held(player, 8)).toBe(1);
  });

  // The failure the whole design is arranged around. Two slots, both spoken
  // for, and neither stack is emptied by the recipe: the sword has nowhere to
  // go, so the materials must still be there afterwards.
  it('takes nothing when the bag has no room for the product', async () => {
    const crafting = await bootWith(sword);
    const player = smith(2);
    player.inventory.items = [
      { item: 2, quantity: 2 },
      { item: 3, quantity: 60 },
    ];

    expect(crafting.craft(player, 'steel-sword')).toBe(
      'Your bag is too full to hold that.',
    );
    expect(held(player, 2)).toBe(2);
    expect(held(player, 3)).toBe(60);
    expect(held(player, 8)).toBe(0);
  });

  // The mirror of the case above, and the reason capacity is judged against
  // the inventory the exchange leaves behind: spending the last hilt frees the
  // slot the sword goes into, so a full bag is not automatically a refusal.
  it('crafts into the slot an emptied stack gives back', async () => {
    const crafting = await bootWith(sword);
    const player = smith(2);

    expect(crafting.craft(player, 'steel-sword')).toBe('Crafted.');
    expect(held(player, 2)).toBe(0);
    expect(held(player, 8)).toBe(1);
  });

  it('refuses a recipe the player cannot pay for, taking nothing', async () => {
    const crafting = await bootWith(sword);
    const player = smith();
    player.inventory.items = [{ item: 3, quantity: 60 }];

    expect(crafting.craft(player, 'steel-sword')).toBe(
      'You are missing materials.',
    );
    expect(held(player, 3)).toBe(60);
  });

  // The window draws a recipe from this alone: what each line is called and
  // looks like, how much of it the player holds, and why a craft was refused.
  it('tells the window what each material is and how much of it is held', async () => {
    await bootWith(sword);
    const player = smith();
    player.inventory.items = [{ item: 3, quantity: 60 }];
    benchUnder(player);

    expect(ask('crafting:request')[0]?.payload).toEqual([
      {
        id: 'steel-sword',
        name: 'Steel Sword',
        inputs: [
          { itemId: 2, quantity: 1, held: 0, name: 'Hilt', sprite: 0 },
          { itemId: 3, quantity: 50, held: 60, name: 'Iron Ore', sprite: 0 },
        ],
        output: {
          itemId: 8,
          quantity: 1,
          name: 'Steel Sword',
          sprite: 0,
          description: '',
        },
        missing: [{ itemId: 2, quantity: 1, held: 0, name: 'Hilt', sprite: 0 }],
      },
    ]);
    expect(ask('crafting:craft', { recipeId: 'steel-sword' })).toEqual([
      expect.objectContaining({
        channel: 'crafting:result',
        payload: { message: 'You are missing materials.' },
      }),
    ]);
  });

  it('refuses an id no recipe defines', async () => {
    const crafting = await bootWith(sword);
    expect(crafting.craft(smith(), 'nonsense')).toBe('No such recipe.');
  });

  // A recipe read once at load would answer with the boot-time cost until
  // someone restarted the server, which defeats the point of the editor.
  it('crafts at the cost the editor last saved, without a reload', async () => {
    const crafting = await bootWith(sword);
    const player = smith();

    await createOrUpdateRecipe({
      ...sword,
      inputs: [{ itemId: 3, quantity: 10 }],
    });

    expect(crafting.craft(player, 'steel-sword')).toBe('Crafted.');
    expect(held(player, 3)).toBe(50);
    expect(held(player, 2)).toBe(1); // no longer part of the recipe
  });
});

// The window's craft is judged on where the player stands now, as a shop
// purchase is: a recipe id in the request says nothing about the place.
describe('where crafting happens', () => {
  const craftResult = () =>
    ask('crafting:craft', { recipeId: 'steel-sword' }).find(
      (e) => e.channel === 'crafting:result',
    )?.payload;

  it('crafts on a tile whose trigger is a workbench', async () => {
    await bootWith(sword);
    const player = smith();
    benchUnder(player);

    expect(craftResult()).toEqual({ message: 'Crafted.' });
    expect(held(player, 8)).toBe(1);
  });

  it('crafts beside an npc carrying the workbench', async () => {
    await bootWith(sword);
    const sim = createFixture(0);
    const player = smith(10, sim);
    sim.addNpc({ scriptId: 'workbench', position: tile(2, 1) });
    rebuildQuadtree(sim.mapId, sim.map);

    expect(craftResult()).toEqual({ message: 'Crafted.' });
    expect(held(player, 8)).toBe(1);
  });

  it('refuses anywhere else, taking nothing', async () => {
    await bootWith(sword);
    const sim = createFixture(0);
    const player = smith(10, sim);
    sim.addNpc({ scriptId: 'workbench', position: tile(3, 1) });
    rebuildQuadtree(sim.mapId, sim.map);

    expect(craftResult()).toEqual({
      message: 'Stand at a workbench to craft.',
    });
    expect(held(player, 3)).toBe(60);
    expect(held(player, 8)).toBe(0);
  });
});

describe('recipe conditions', () => {
  const gated: Recipe = { ...sword, condition: 'knowsSmithing' };

  it('hides a recipe whose condition says no, and refuses the craft', async () => {
    const crafting = await bootWith(gated);
    const player = smith();

    const handle = runInSandbox(
      `provide('recipeCondition.knowsSmithing', () => false);`,
      'smithing.js',
    );

    expect(crafting.available(player)).toEqual([]);
    expect(crafting.craft(player, 'steel-sword')).toBe(
      'You have not learned that recipe.',
    );
    expect(held(player, 3)).toBe(60);

    handle.cleanup();
  });

  it('offers it once the condition says yes', async () => {
    const crafting = await bootWith(gated);
    const player = smith();

    const handle = runInSandbox(
      `provide('recipeCondition.knowsSmithing', ({ player }) => player.level >= 1);`,
      'smithing.js',
    );

    expect(crafting.available(player).map((r) => r.id)).toEqual([
      'steel-sword',
    ]);
    expect(crafting.craft(player, 'steel-sword')).toBe('Crafted.');

    handle.cleanup();
  });

  // A recipe gated on a rule nobody loaded is not an open recipe: treating a
  // missing predicate as permission would make a typo in the editor grant
  // exactly the thing the condition was written to withhold.
  it('hides a recipe naming a condition no script registered', async () => {
    const crafting = await bootWith(gated);
    const player = smith();

    expect(crafting.available(player)).toEqual([]);
    expect(crafting.craft(player, 'steel-sword')).toBe(
      'You have not learned that recipe.',
    );
  });
});

describe('script definitions', () => {
  it('lets a script define a recipe the editor never authored', async () => {
    const crafting = await bootWith();
    const player = smith();

    crafting.define({
      id: 'scripted',
      name: 'Scripted',
      inputs: [{ itemId: 3, quantity: 5 }],
      output: { itemId: 8, quantity: 1 },
    });

    expect(crafting.craft(player, 'scripted')).toBe('Crafted.');
    expect(held(player, 3)).toBe(55);
  });

  // Same rule the quest module follows: an escape hatch that loses is not one.
  it('lets a script definition win over content of the same id', async () => {
    const crafting = await bootWith(sword);
    const player = smith();

    crafting.define({
      ...sword,
      inputs: [{ itemId: 3, quantity: 1 }],
    });

    expect(crafting.craft(player, 'steel-sword')).toBe('Crafted.');
    expect(held(player, 3)).toBe(59);
    expect(held(player, 2)).toBe(1);
  });
});
