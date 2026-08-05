import { describe, it, expect } from 'vitest';
import {
  validateContentReferences,
  validateWorldGraph,
  validateScriptReferences,
} from './contentValidation.js';
import {
  SCRIPT_BEHAVIOR_EVENTS,
  type ScriptBehaviorEvent,
  type ScriptParamSpec,
} from '../../../shared/scriptParams.js';

const items = [{ id: 1 }, { id: 2 }];

describe('validateContentReferences', () => {
  describe('npc drops', () => {
    it('accepts drops that resolve to real items', () => {
      const result = validateContentReferences({
        items,
        npcs: [{ id: 'goblin', itemsToDrop: [{ itemId: 1 }, { itemId: 2 }] }],
      });
      expect(result.warnings).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it('warns on a drop pointing at a missing item', () => {
      const result = validateContentReferences({
        items,
        npcs: [{ id: 'goblin', name: 'Goblin', itemsToDrop: [{ itemId: 42 }] }],
      });
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('goblin');
      expect(result.warnings[0]).toContain('42');
      // Dangling refs never block the save.
      expect(result.errors).toEqual([]);
    });

    it('reports every broken drop, not just the first', () => {
      const result = validateContentReferences({
        items,
        npcs: [
          { id: 'a', itemsToDrop: [{ itemId: 91 }, { itemId: 92 }] },
          { id: 'b', itemsToDrop: [{ itemId: 93 }] },
        ],
      });
      expect(result.warnings).toHaveLength(3);
    });

    it('ignores an npc with no drops', () => {
      const result = validateContentReferences({
        items,
        npcs: [{ id: 'peaceful' }],
      });
      expect(result.warnings).toEqual([]);
    });
  });

  describe('shop products', () => {
    it('warns on a product pointing at a missing item', () => {
      const result = validateContentReferences({
        items,
        shops: [{ id: 'general', products: [{ itemId: 1 }, { itemId: 77 }] }],
      });
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('77');
    });
  });

  describe('map dropped items', () => {
    it('warns on ground loot pointing at a missing item', () => {
      const result = validateContentReferences({
        items,
        maps: [{ id: 'town', droppedItems: [{ itemId: 55 }] }],
      });
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('55');
    });
  });

  describe('duplicate ids', () => {
    it('errors when two documents share an id, since upsert collapses them', () => {
      const result = validateContentReferences({
        items: [{ id: 1 }, { id: 1 }],
      });
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Duplicate item id "1"');
    });

    it('reports a repeated id once, not once per occurrence', () => {
      const result = validateContentReferences({
        items: [{ id: 1 }, { id: 1 }, { id: 1 }],
      });
      expect(result.errors).toHaveLength(1);
    });

    it('catches duplicates in every collection', () => {
      const result = validateContentReferences({
        items,
        npcs: [{ id: 'x' }, { id: 'x' }],
        shops: [{ id: 'y' }, { id: 'y' }],
        maps: [{ id: 'z' }, { id: 'z' }],
      });
      expect(result.errors).toHaveLength(3);
    });

    it('ignores unsaved documents that have no id yet', () => {
      const result = validateContentReferences({
        items,
        npcs: [{ name: 'New A' }, { name: 'New B' }],
      });
      expect(result.errors).toEqual([]);
    });
  });

  describe('partial graphs', () => {
    it('stays quiet when the item list is absent, instead of crying wolf', () => {
      const result = validateContentReferences({
        npcs: [{ id: 'goblin', itemsToDrop: [{ itemId: 42 }] }],
      });
      expect(result.warnings).toEqual([]);
    });

    it('still catches duplicates without an item list', () => {
      const result = validateContentReferences({
        npcs: [{ id: 'dup' }, { id: 'dup' }],
      });
      expect(result.errors).toHaveLength(1);
    });

    it('handles an entirely empty graph', () => {
      const result = validateContentReferences({});
      expect(result).toEqual({ errors: [], warnings: [] });
    });
  });

  it('labels an unsaved document by name so the message is still useful', () => {
    const result = validateContentReferences({
      items,
      npcs: [{ name: 'Draft Goblin', itemsToDrop: [{ itemId: 99 }] }],
    });
    expect(result.warnings[0]).toContain('Draft Goblin');
  });
});

describe('validateScriptReferences', () => {
  const behavior = (
    events: ScriptBehaviorEvent[],
    params: ScriptParamSpec[] = [],
  ) => ({ events, params });

  const registered = new Map([
    ['trap', behavior(['onEnter', 'onUse'])],
    ['sage', behavior(['onInteract'])],
    ['crown', behavior(['onEquip', 'onUnequip'])],
  ]);

  it('accepts references to behaviors a script registered', () => {
    const result = validateScriptReferences(
      {
        npcs: [{ id: 'elder', scriptId: 'sage' }],
        items: [{ id: 1, type: 'consumable', scriptId: 'trap' }],
      },
      registered,
    );
    expect(result.warnings).toEqual([]);
  });

  it('warns about an npc naming a behavior nobody registered', () => {
    const result = validateScriptReferences(
      { npcs: [{ id: 'elder', name: 'Elder', scriptId: 'missing' }] },
      registered,
    );
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('elder');
    expect(result.warnings[0]).toContain('missing');
  });

  it('warns about an item naming a behavior nobody registered', () => {
    const result = validateScriptReferences(
      {
        items: [
          { id: 7, name: 'Scroll', type: 'consumable', scriptId: 'nope' },
        ],
      },
      registered,
    );
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('nope');
  });

  // The behavior exists and is wired, and still nothing runs: the silent
  // failure of a dangling id, one level in.
  describe('behavior with no handler for this content', () => {
    it('warns when equipment names a consumable-only behavior', () => {
      const result = validateScriptReferences(
        { items: [{ id: 7, name: 'Sword', type: 'weapon', scriptId: 'trap' }] },
        registered,
      );
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('onEquip or onUnequip');
    });

    it('warns when a consumable names an equip-only behavior', () => {
      const result = validateScriptReferences(
        {
          items: [
            { id: 7, name: 'Potion', type: 'consumable', scriptId: 'crown' },
          ],
        },
        registered,
      );
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('onUse');
    });

    it('accepts equipment naming an equip behavior', () => {
      const result = validateScriptReferences(
        { items: [{ id: 7, type: 'helmet', scriptId: 'crown' }] },
        registered,
      );
      expect(result.warnings).toEqual([]);
    });

    it('warns when an npc names a behavior that only runs on tiles', () => {
      const result = validateScriptReferences(
        { npcs: [{ id: 'elder', scriptId: 'trap' }] },
        registered,
      );
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('onInteract or onDeath');
    });

    // Nothing dispatches behaviors on money, so any id there is dead wiring.
    it('warns about a behavior on an item type no event reaches', () => {
      const result = validateScriptReferences(
        { items: [{ id: 7, type: 'money', scriptId: 'trap' }] },
        registered,
      );
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('no behavior event ever reaches');
    });
  });

  // The case the whole feature exists for: a tile that saves clean and does
  // nothing at runtime, with no signal anywhere.
  it('warns about a script tile pointing at nothing, with its coordinates', () => {
    const result = validateScriptReferences(
      {
        maps: [
          {
            id: 'town',
            tiles: [
              [{}, {}],
              [{}, { triggers: [{ action: 'script', scriptId: 'ghost' }] }],
            ],
          },
        ],
      },
      registered,
    );
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('ghost');
    expect(result.warnings[0]).toContain('(1, 1)');
  });

  it('ignores non-script triggers on the same tile', () => {
    const result = validateScriptReferences(
      {
        maps: [
          {
            id: 'town',
            tiles: [[{ triggers: [{ action: 'heal' }, { action: 'kill' }] }]],
          },
        ],
      },
      registered,
    );
    expect(result.warnings).toEqual([]);
  });

  it('ignores content with no behavior attached', () => {
    const result = validateScriptReferences(
      { npcs: [{ id: 'plain' }], items: [{ id: 1 }] },
      registered,
    );
    expect(result.warnings).toEqual([]);
  });

  it('reports every broken reference, not just the first', () => {
    const result = validateScriptReferences(
      {
        npcs: [
          { id: 'a', scriptId: 'x' },
          { id: 'b', scriptId: 'y' },
        ],
      },
      registered,
    );
    expect(result.warnings).toHaveLength(2);
  });

  // Dangling behavior references never block a save, same as dangling item ids.
  it('never produces errors', () => {
    const result = validateScriptReferences(
      { npcs: [{ id: 'a', scriptId: 'missing' }] },
      new Map(),
    );
    expect(result.errors).toEqual([]);
  });

  it('handles an empty graph', () => {
    expect(validateScriptReferences({}, registered)).toEqual({
      errors: [],
      warnings: [],
    });
  });

  // Renaming a param in the script leaves every piece of content carrying
  // the old key, which resolution then drops silently.
  describe('declared params', () => {
    // Implements every event, so what these assert is the params alone.
    const withParams = new Map([
      [
        'chest',
        behavior(
          [...SCRIPT_BEHAVIOR_EVENTS],
          [
            { key: 'itemId', type: 'item' as const, required: true },
            { key: 'quantity', type: 'number' as const },
          ],
        ),
      ],
    ]);

    it('accepts values that fit the declaration', () => {
      const result = validateScriptReferences(
        {
          npcs: [
            {
              id: 'elder',
              scriptId: 'chest',
              scriptParams: { itemId: 3, quantity: 2 },
            },
          ],
        },
        withParams,
      );
      expect(result.warnings).toEqual([]);
    });

    it('warns about a stored param the behavior does not declare', () => {
      const result = validateScriptReferences(
        {
          items: [
            {
              id: 7,
              name: 'Scroll',
              type: 'consumable',
              scriptId: 'chest',
              scriptParams: { itemId: 3, qty: 2 },
            },
          ],
        },
        withParams,
      );
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('"qty"');
      expect(result.warnings[0]).toContain('Scroll');
    });

    it('warns about a required param left empty, naming the tile', () => {
      const result = validateScriptReferences(
        {
          maps: [
            {
              id: 'town',
              tiles: [
                [{ triggers: [{ action: 'script', scriptId: 'chest' }] }],
              ],
            },
          ],
        },
        withParams,
      );
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('(0, 0)');
      expect(result.warnings[0]).toContain('itemId');
    });

    it('warns about a value the declared type cannot hold', () => {
      const result = validateScriptReferences(
        {
          npcs: [
            {
              id: 'elder',
              scriptId: 'chest',
              scriptParams: { itemId: 'potion' },
            },
          ],
        },
        withParams,
      );
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('not a valid item');
    });

    // A dangling reference is already reported; adding "and its params are
    // wrong" on top of it says nothing new.
    it('does not check params against a behavior nobody registered', () => {
      const result = validateScriptReferences(
        { npcs: [{ id: 'elder', scriptId: 'ghost', scriptParams: { a: 1 } }] },
        withParams,
      );
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('ghost');
    });
  });
});

describe('loot tables', () => {
  it('warns when a table drops an item that does not exist', () => {
    const result = validateContentReferences({
      items,
      lootTables: [
        {
          id: 'goblin',
          name: 'Goblin',
          guaranteed: [{ itemId: 1 }],
          entries: [{ itemId: 777 }],
        },
      ],
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('777');
    expect(result.warnings[0]).toContain('goblin');
  });

  it('checks both the guaranteed list and the weighted pool', () => {
    const result = validateContentReferences({
      items,
      lootTables: [
        { id: 't', guaranteed: [{ itemId: 91 }], entries: [{ itemId: 92 }] },
      ],
    });
    expect(result.warnings).toHaveLength(2);
  });

  it('errors on two tables sharing an id', () => {
    const result = validateContentReferences({
      lootTables: [{ id: 'dup' }, { id: 'dup' }],
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('loot table');
  });

  // An npc pointing at a deleted table silently rolls its legacy drops
  // instead, so the loot changes without anything failing.
  it('warns when an npc uses a table that does not exist', () => {
    const result = validateContentReferences({
      items,
      npcs: [{ id: 'goblin', name: 'Goblin', lootTableId: 'gone' }],
      lootTables: [{ id: 'present' }],
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('gone');
  });

  it('accepts an npc pointing at a table that exists', () => {
    const result = validateContentReferences({
      items,
      npcs: [{ id: 'goblin', lootTableId: 'present' }],
      lootTables: [{ id: 'present' }],
    });
    expect(result.warnings).toEqual([]);
  });

  // Same convention as dangling item ids: without the collection there is
  // nothing to resolve against, so staying quiet beats crying wolf.
  it('says nothing about lootTableId when no tables were supplied', () => {
    const result = validateContentReferences({
      items,
      npcs: [{ id: 'goblin', lootTableId: 'anything' }],
    });
    expect(result.warnings).toEqual([]);
  });
});

describe('dialogs', () => {
  const greet = {
    id: 'greet',
    choices: [{ next: 'bye' }, { next: undefined }],
  };
  const bye = { id: 'bye' };

  it('accepts a conversation whose choices all land on a node', () => {
    const result = validateContentReferences({
      dialogs: [{ id: 'elder', name: 'Elder', nodes: [greet, bye] }],
    });
    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  // The choice looks wired in the editor and simply ends the conversation at
  // runtime, the same silence a dangling item id would have.
  it('warns about a choice leading to a node that does not exist', () => {
    const result = validateContentReferences({
      dialogs: [
        {
          id: 'elder',
          nodes: [{ id: 'greet', choices: [{ next: 'missing' }] }],
        },
      ],
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('missing');
  });

  it('warns when the start node does not exist', () => {
    const result = validateContentReferences({
      dialogs: [{ id: 'elder', start: 'nowhere', nodes: [greet, bye] }],
    });
    expect(result.warnings.some((w) => w.includes('nowhere'))).toBe(true);
  });

  // A node nothing points at is a branch a player never sees, the check the
  // world graph runs on maps one level down.
  it('warns about a node unreachable from the start', () => {
    const result = validateContentReferences({
      dialogs: [
        {
          id: 'elder',
          nodes: [
            { id: 'greet', choices: [{ next: 'bye' }] },
            bye,
            { id: 'orphan' },
          ],
        },
      ],
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('orphan');
  });

  it('follows start rather than the first node when deciding reachability', () => {
    const result = validateContentReferences({
      dialogs: [
        {
          id: 'elder',
          start: 'bye',
          nodes: [{ id: 'greet', choices: [{ next: 'bye' }] }, bye],
        },
      ],
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('greet');
  });

  // Two nodes under one id collapse on lookup, so one of them is unreachable
  // text that the editor still shows as saved.
  it('errors on duplicate node ids inside one dialog', () => {
    const result = validateContentReferences({
      dialogs: [{ id: 'elder', nodes: [{ id: 'greet' }, { id: 'greet' }] }],
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('greet');
  });

  it('errors on two dialogs sharing an id', () => {
    const result = validateContentReferences({
      dialogs: [
        { id: 'elder', nodes: [greet, bye] },
        { id: 'elder', nodes: [greet, bye] },
      ],
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('elder');
  });

  it('warns when an npc opens a dialog that does not exist', () => {
    const result = validateContentReferences({
      npcs: [{ id: 'goblin', name: 'Goblin', dialogId: 'gone' }],
      dialogs: [{ id: 'elder', nodes: [greet, bye] }],
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('gone');
  });

  it('says nothing about dialogId when no dialogs were supplied', () => {
    const result = validateContentReferences({
      npcs: [{ id: 'goblin', dialogId: 'anything' }],
    });
    expect(result.warnings).toEqual([]);
  });
});

describe('validateWorldGraph', () => {
  const T = 64; // TILE_SIZE
  const at = (col: number, row: number) => ({ x: col * T, y: row * T });

  /** A rectangular map of plain tiles, with specific tiles overridden. */
  const mapOf = (
    id: string,
    overrides: Record<string, Record<string, unknown>> = {},
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    name: id,
    tiles: Array.from({ length: 3 }, (_, row) =>
      // No tileIndex: this validator reads warps, blocking and spawns, and
      // TileRef models exactly that.
      Array.from({ length: 3 }, (_, col) => ({
        ...(overrides[`${col},${row}`] ?? {}),
      })),
    ),
    ...extra,
  });

  const world = { startMapId: 'a', respawnTile: { col: 0, row: 0 } };

  describe('warp landings', () => {
    it('reports a warp that lands on another warp', () => {
      const result = validateWorldGraph({
        maps: [
          mapOf('a', { '1,1': { warp: { to: 'b', position: at(2, 2) } } }),
          mapOf('b', { '2,2': { warp: { to: 'a', position: at(1, 1) } } }),
        ],
      });

      // Both directions are reported: each one bounces the player on arrival.
      expect(result.warnings).toHaveLength(2);
      expect(result.warnings[0]).toMatch(/lands on another warp/);
    });

    it('accepts a two-way door, which is a loop and is meant to be', () => {
      const result = validateWorldGraph({
        maps: [
          // The return warp sits on a different tile than the one it lands on,
          // which is what a normal door looks like. Naive cycle detection
          // would call this a bug.
          mapOf('a', { '1,1': { warp: { to: 'b', position: at(0, 0) } } }),
          mapOf('b', { '1,1': { warp: { to: 'a', position: at(0, 0) } } }),
        ],
      });

      expect(result.warnings).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it('reports a warp that lands inside a wall', () => {
      const result = validateWorldGraph({
        maps: [
          mapOf('a', { '1,1': { warp: { to: 'b', position: at(2, 2) } } }),
          mapOf('b', { '2,2': { blocked: true } }),
        ],
      });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatch(/blocked tile/);
    });
  });

  describe('reachability', () => {
    it('reports a map no warp or border link leads to', () => {
      const result = validateWorldGraph(
        { maps: [mapOf('a'), mapOf('island')] },
        world,
      );

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatch(/"island".*cannot be reached/);
    });

    it('follows border links, not just warp tiles', () => {
      const result = validateWorldGraph(
        {
          maps: [
            mapOf(
              'a',
              {},
              { borderLinks: { up: { to: 'b', position: at(0, 0) } } },
            ),
            mapOf('b'),
          ],
        },
        world,
      );

      expect(result.warnings).toEqual([]);
    });

    it('follows a chain rather than only direct neighbours', () => {
      const result = validateWorldGraph(
        {
          maps: [
            mapOf('a', { '1,1': { warp: { to: 'b', position: at(0, 0) } } }),
            mapOf('b', { '1,1': { warp: { to: 'c', position: at(0, 0) } } }),
            mapOf('c'),
          ],
        },
        world,
      );

      expect(result.warnings).toEqual([]);
    });

    it('says nothing about reachability with no start to measure from', () => {
      // Without a root every map is unreachable, and reporting all of them
      // would be worse than staying quiet.
      const result = validateWorldGraph({
        maps: [mapOf('a'), mapOf('island')],
      });
      expect(result.warnings).toEqual([]);
    });
  });

  describe('spawn coverage', () => {
    it('errors when the respawn tile is inside a wall', () => {
      const result = validateWorldGraph(
        { maps: [mapOf('a', { '0,0': { blocked: true } })] },
        world,
      );

      // Every player at once, not one piece of content, so an error.
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatch(/spawn inside a wall/);
    });

    it('errors when the respawn tile is off the map', () => {
      const result = validateWorldGraph(
        { maps: [mapOf('a')] },
        {
          startMapId: 'a',
          respawnTile: { col: 99, row: 99 },
        },
      );

      expect(result.errors[0]).toMatch(/outside the start map/);
    });

    it('reports an npc no tile spawns', () => {
      const result = validateWorldGraph({
        maps: [mapOf('a', { '1,1': { npcSpawn: 'goblin' } })],
        npcs: [{ id: 'goblin' }, { id: 'dragon', name: 'Dragon' }],
      });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatch(/"dragon" \(Dragon\).*never appears/);
    });
  });

  it('stays quiet when maps carry no tiles, as the editor sends them', () => {
    const result = validateWorldGraph(
      { maps: [{ id: 'a', name: 'A' }], npcs: [{ id: 'goblin' }] },
      world,
    );

    expect(result).toEqual({ errors: [], warnings: [] });
  });
});

describe('quests', () => {
  const orcs = {
    id: 'orcs',
    name: 'Orcs',
    objective: { type: 'kill', npcId: 'orc' },
  };

  it('accepts an objective whose npc exists', () => {
    const result = validateContentReferences({
      quests: [orcs],
      npcs: [{ id: 'orc' }],
    });
    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  // The quest is offered, accepted, and then sits in the tracker forever,
  // which is worse than a save that refuses: nothing looks wrong until a
  // player has already spent an evening on it.
  it('warns when the npc it counts does not exist', () => {
    const result = validateContentReferences({
      quests: [orcs],
      npcs: [{ id: 'goblin' }],
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/orc.*never be completed/);
  });

  it('warns when a collect objective asks for an unknown item', () => {
    const result = validateContentReferences({
      quests: [
        { id: 'coins', objective: { type: 'collect', itemId: 99, count: 5 } },
      ],
      items: [{ id: 3 }],
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/99.*never be completed/);
  });

  it('warns when a reward hands out an item that does not exist', () => {
    const result = validateContentReferences({
      quests: [
        {
          id: 'coins',
          objective: { type: 'collect', itemId: 3, count: 5 },
          reward: { items: [{ itemId: 99 }] },
        },
      ],
      items: [{ id: 3 }],
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/rewards unknown item 99/);
  });

  it('warns when a reach objective names a map that does not exist', () => {
    const result = validateContentReferences({
      quests: [
        {
          id: 'scout',
          objective: { type: 'reach', mapId: '7', row: 1, col: 1 },
        },
      ],
      maps: [{ id: '1' }],
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/unknown map "7"/);
  });

  it('warns when an npc offers a quest that does not exist', () => {
    const result = validateContentReferences({
      npcs: [{ id: 'guard', questId: 'ghost' }, { id: 'orc' }],
      quests: [orcs],
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/offers unknown quest "ghost"/);
  });

  // The other door into a quest. A typo here is a dialog button that looks
  // like an offer and does nothing at all when pressed.
  it('warns when a dialog choice starts a quest that does not exist', () => {
    const result = validateContentReferences({
      quests: [orcs],
      dialogs: [
        {
          id: 'guard-gate',
          nodes: [{ id: 'gate', choices: [{ action: 'questStart:ghost' }] }],
        },
      ],
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/starts unknown quest "ghost"/);
  });

  it('leaves other dialog actions alone', () => {
    const result = validateContentReferences({
      quests: [orcs],
      dialogs: [
        {
          id: 'guard-gate',
          nodes: [{ id: 'gate', choices: [{ action: 'guardGift' }] }],
        },
      ],
    });
    expect(result.warnings).toEqual([]);
  });

  it('reports two quests sharing an id, which upsert would collapse', () => {
    const result = validateContentReferences({
      quests: [orcs, { id: 'orcs', name: 'Other' }],
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/quest.*orcs/i);
  });
});
