import { describe, it, expect } from 'vitest';
import { Access } from '../../shared/types.js';
import {
  LoginBodySchema,
  RegisterBodySchema,
  BanBodySchema,
  SetAccessBodySchema,
  ChangeSpriteBodySchema,
  SetSpriteBodySchema,
  GoMapBodySchema,
  SaveMapBodySchema,
  CreateNpcBodySchema,
  CreateItemBodySchema,
  AssignPointsBodySchema,
  BuyShopItemBodySchema,
} from './bodySchemas.js';

describe('LoginBodySchema', () => {
  it('accepts valid credentials', () => {
    expect(
      LoginBodySchema.safeParse({ username: 'alice', password: 'secret' })
        .success,
    ).toBe(true);
  });
  it('rejects missing username', () => {
    expect(LoginBodySchema.safeParse({ password: 'secret' }).success).toBe(
      false,
    );
  });
  it('rejects empty password', () => {
    expect(
      LoginBodySchema.safeParse({ username: 'alice', password: '' }).success,
    ).toBe(false);
  });
});

describe('RegisterBodySchema', () => {
  it('accepts valid registration', () => {
    expect(
      RegisterBodySchema.safeParse({ username: 'bob', password: 'pass' })
        .success,
    ).toBe(true);
  });
  it('rejects username over 24 chars', () => {
    expect(
      RegisterBodySchema.safeParse({ username: 'a'.repeat(25), password: 'p' })
        .success,
    ).toBe(false);
  });
  it('rejects empty username', () => {
    expect(
      RegisterBodySchema.safeParse({ username: '', password: 'pass' }).success,
    ).toBe(false);
  });
});

describe('BanBodySchema', () => {
  it('accepts minimal ban (name only)', () => {
    expect(BanBodySchema.safeParse({ playerName: 'alice' }).success).toBe(true);
  });
  it('accepts full ban with reason and until', () => {
    const result = BanBodySchema.safeParse({
      playerName: 'alice',
      reason: 'cheating',
      until: 9999999999,
    });
    expect(result.success).toBe(true);
  });
  it('rejects non-positive until', () => {
    expect(
      BanBodySchema.safeParse({ playerName: 'alice', until: 0 }).success,
    ).toBe(false);
    expect(
      BanBodySchema.safeParse({ playerName: 'alice', until: -1 }).success,
    ).toBe(false);
  });
  it('rejects empty playerName', () => {
    expect(BanBodySchema.safeParse({ playerName: '' }).success).toBe(false);
  });
});

describe('SetAccessBodySchema', () => {
  it('accepts valid access levels', () => {
    expect(
      SetAccessBodySchema.safeParse({
        playerName: 'alice',
        accessLevel: Access.USER,
      }).success,
    ).toBe(true);
    expect(
      SetAccessBodySchema.safeParse({
        playerName: 'alice',
        accessLevel: Access.MOD,
      }).success,
    ).toBe(true);
    expect(
      SetAccessBodySchema.safeParse({
        playerName: 'alice',
        accessLevel: Access.ADMIN,
      }).success,
    ).toBe(true);
  });
  it('rejects invalid access level', () => {
    expect(
      SetAccessBodySchema.safeParse({ playerName: 'alice', accessLevel: 99 })
        .success,
    ).toBe(false);
  });
});

describe('ChangeSpriteBodySchema', () => {
  it('accepts non-negative integer spriteId', () => {
    expect(ChangeSpriteBodySchema.safeParse({ spriteId: 0 }).success).toBe(
      true,
    );
    expect(ChangeSpriteBodySchema.safeParse({ spriteId: 42 }).success).toBe(
      true,
    );
  });
  it('rejects negative spriteId', () => {
    expect(ChangeSpriteBodySchema.safeParse({ spriteId: -1 }).success).toBe(
      false,
    );
  });
  it('rejects non-integer spriteId', () => {
    expect(ChangeSpriteBodySchema.safeParse({ spriteId: 1.5 }).success).toBe(
      false,
    );
  });
  it('rejects string spriteId', () => {
    expect(ChangeSpriteBodySchema.safeParse({ spriteId: '5' }).success).toBe(
      false,
    );
  });
});

describe('SetSpriteBodySchema', () => {
  it('requires both playerName and spriteId', () => {
    expect(
      SetSpriteBodySchema.safeParse({ playerName: 'alice', spriteId: 3 })
        .success,
    ).toBe(true);
    expect(SetSpriteBodySchema.safeParse({ playerName: 'alice' }).success).toBe(
      false,
    );
    expect(SetSpriteBodySchema.safeParse({ spriteId: 3 }).success).toBe(false);
  });
});

describe('GoMapBodySchema', () => {
  it('accepts non-empty mapId', () => {
    expect(GoMapBodySchema.safeParse({ mapId: '1' }).success).toBe(true);
  });
  it('rejects empty mapId', () => {
    expect(GoMapBodySchema.safeParse({ mapId: '' }).success).toBe(false);
  });
});

describe('SaveMapBodySchema', () => {
  const validTile = { tileIndex: 0 };
  it('accepts valid map save payload', () => {
    const result = SaveMapBodySchema.safeParse({
      mapId: '1',
      name: 'Test Map',
      type: 'normal',
      tiles: [[validTile]],
    });
    expect(result.success).toBe(true);
  });
  it('rejects invalid map type', () => {
    expect(
      SaveMapBodySchema.safeParse({
        mapId: '1',
        name: 'X',
        type: 'boss',
        tiles: [[validTile]],
      }).success,
    ).toBe(false);
  });
  it('accepts tileIndex -1 (empty tile sentinel)', () => {
    expect(
      SaveMapBodySchema.safeParse({
        mapId: '1',
        name: 'X',
        type: 'normal',
        tiles: [[{ tileIndex: -1 }]],
      }).success,
    ).toBe(true);
  });
  it('rejects tileIndex below -1', () => {
    expect(
      SaveMapBodySchema.safeParse({
        mapId: '1',
        name: 'X',
        type: 'normal',
        tiles: [[{ tileIndex: -2 }]],
      }).success,
    ).toBe(false);
  });
});

describe('CreateNpcBodySchema', () => {
  it('accepts valid NPC', () => {
    const result = CreateNpcBodySchema.safeParse({
      name: 'Goblin',
      sprite: 1,
      maxHealth: 100,
      attack: 10,
      behavior: 'aggressive',
    });
    expect(result.success).toBe(true);
  });
  it('accepts all valid behaviors', () => {
    const behaviors = [
      'aggressive',
      'hostile',
      'neutral',
      'friendly',
      'shopkeeper',
      'guard',
    ] as const;
    for (const behavior of behaviors) {
      expect(
        CreateNpcBodySchema.safeParse({
          name: 'X',
          sprite: 0,
          maxHealth: 1,
          attack: 0,
          behavior,
        }).success,
      ).toBe(true);
    }
  });
  it('rejects unknown behavior', () => {
    expect(
      CreateNpcBodySchema.safeParse({
        name: 'X',
        sprite: 0,
        maxHealth: 1,
        attack: 0,
        behavior: 'boss',
      }).success,
    ).toBe(false);
  });
  // z.object strips what it does not declare, so a field missing here is
  // saved by the editor and never reaches the database: the npc would come
  // back with no quest.
  it('keeps the content references an npc points at', () => {
    const result = CreateNpcBodySchema.safeParse({
      name: 'X',
      sprite: 0,
      maxHealth: 1,
      attack: 0,
      behavior: 'neutral',
      lootTableId: 'common',
      dialogId: 'greet',
      questId: 'orcs',
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      lootTableId: 'common',
      dialogId: 'greet',
      questId: 'orcs',
    });
  });
  it('rejects zero or negative maxHealth', () => {
    expect(
      CreateNpcBodySchema.safeParse({
        name: 'X',
        sprite: 0,
        maxHealth: 0,
        attack: 0,
        behavior: 'neutral',
      }).success,
    ).toBe(false);
  });
  it('validates itemsToDrop drop chance range', () => {
    const valid = {
      name: 'X',
      sprite: 0,
      maxHealth: 1,
      attack: 0,
      behavior: 'neutral',
      itemsToDrop: [{ itemId: 1, chance: 0.5 }],
    };
    expect(CreateNpcBodySchema.safeParse(valid).success).toBe(true);
    const invalid = { ...valid, itemsToDrop: [{ itemId: 1, chance: 1.5 }] };
    expect(CreateNpcBodySchema.safeParse(invalid).success).toBe(false);
  });
});

describe('CreateItemBodySchema', () => {
  it('accepts valid item', () => {
    expect(
      CreateItemBodySchema.safeParse({
        name: 'Sword',
        sprite: 0,
        type: 'weapon',
      }).success,
    ).toBe(true);
  });
  it('rejects invalid item type', () => {
    expect(
      CreateItemBodySchema.safeParse({ name: 'X', sprite: 0, type: 'trash' })
        .success,
    ).toBe(false);
  });
  it('defaults description to empty string', () => {
    const result = CreateItemBodySchema.safeParse({
      name: 'X',
      sprite: 0,
      type: 'consumable',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.description).toBe('');
  });
});

describe('AssignPointsBodySchema', () => {
  it('accepts zero points', () => {
    expect(AssignPointsBodySchema.safeParse({}).success).toBe(true);
  });
  it('accepts valid point distribution', () => {
    expect(
      AssignPointsBodySchema.safeParse({
        vitality: 3,
        strength: 2,
        defense: 1,
        agility: 4,
      }).success,
    ).toBe(true);
  });
  it('rejects negative points', () => {
    expect(AssignPointsBodySchema.safeParse({ vitality: -1 }).success).toBe(
      false,
    );
  });
  it('rejects non-integer points', () => {
    expect(AssignPointsBodySchema.safeParse({ vitality: 1.5 }).success).toBe(
      false,
    );
  });
});

describe('BuyShopItemBodySchema', () => {
  it('accepts valid purchase', () => {
    expect(
      BuyShopItemBodySchema.safeParse({ shopId: 'shop1', itemId: 5 }).success,
    ).toBe(true);
  });
  it('rejects empty shopId', () => {
    expect(
      BuyShopItemBodySchema.safeParse({ shopId: '', itemId: 1 }).success,
    ).toBe(false);
  });
  it('rejects negative itemId', () => {
    expect(
      BuyShopItemBodySchema.safeParse({ shopId: 'shop1', itemId: -1 }).success,
    ).toBe(false);
  });
});

// The write boundary for behaviour params. A script's declaration is not a
// licence to write anything into a content document: these land in a Mixed
// Mongoose field that is loaded on every content read.
describe('script params on content', () => {
  const npc = {
    name: 'Goblin',
    sprite: 1,
    maxHealth: 100,
    attack: 10,
    behavior: 'aggressive',
    scriptId: 'chest',
  };

  it('accepts the scalars a form field can hold', () => {
    const result = CreateNpcBodySchema.safeParse({
      ...npc,
      scriptParams: { itemId: 3, message: 'hi', once: true },
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.scriptParams).toEqual({
      itemId: 3,
      message: 'hi',
      once: true,
    });
  });

  it('rejects a nested object, which no param type can hold', () => {
    expect(
      CreateNpcBodySchema.safeParse({
        ...npc,
        scriptParams: { reward: { itemId: 3 } },
      }).success,
    ).toBe(false);
  });

  it('rejects a string over the length cap', () => {
    expect(
      CreateNpcBodySchema.safeParse({
        ...npc,
        scriptParams: { message: 'x'.repeat(513) },
      }).success,
    ).toBe(false);
  });

  it('rejects more keys than any declaration can have', () => {
    const tooMany = Object.fromEntries(
      Array.from({ length: 33 }, (_, i) => [`k${i}`, 1]),
    );
    expect(
      CreateNpcBodySchema.safeParse({ ...npc, scriptParams: tooMany }).success,
    ).toBe(false);
  });

  it('accepts the same values on an item and a script tile', () => {
    expect(
      CreateItemBodySchema.safeParse({
        name: 'Scroll',
        sprite: 1,
        type: 'consumable',
        scriptId: 'teleport',
        scriptParams: { mapId: 'town', col: 9 },
      }).success,
    ).toBe(true);

    expect(
      SaveMapBodySchema.safeParse({
        mapId: 'town',
        name: 'Town',
        type: 'normal',
        tiles: [
          [
            {
              tileIndex: 0,
              triggers: [
                {
                  action: 'script',
                  scriptId: 'chest',
                  scriptParams: { itemId: 3 },
                },
              ],
            },
          ],
        ],
      }).success,
    ).toBe(true);
  });
});
