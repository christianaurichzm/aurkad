import { describe, it, expect } from 'vitest';
import {
  validateContentReferences,
  validateScriptReferences,
} from './contentValidation.js';

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
  const registered = new Set(['trap', 'sage']);

  it('accepts references to behaviors a script registered', () => {
    const result = validateScriptReferences(
      {
        npcs: [{ id: 'elder', scriptId: 'sage' }],
        items: [{ id: 1, scriptId: 'trap' }],
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
      { items: [{ id: 7, name: 'Scroll', scriptId: 'nope' }] },
      registered,
    );
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('nope');
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
      new Set(),
    );
    expect(result.errors).toEqual([]);
  });

  it('handles an empty graph', () => {
    expect(validateScriptReferences({}, registered)).toEqual({
      errors: [],
      warnings: [],
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
