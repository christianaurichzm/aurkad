import { describe, it, expect } from 'vitest';
import { validateContentReferences } from './contentValidation.js';

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
