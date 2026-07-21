import { z } from 'zod';
import type { Response } from 'express';
import {
  Access,
  type ItemType,
  type ModifiablePlayerAttribute,
  type EffectType,
} from '../../shared/types.js';
import { EQUIPMENT_SLOTS } from '../../shared/constants.js';

const PositionSchema = z.object({ x: z.number(), y: z.number() });
const AccessSchema = z.nativeEnum(Access);
const MapTypeSchema = z.enum(['pvp', 'normal']);
const PvpMoraleSchema = z.enum(['safe', 'normal', 'no-penalty']);
const NpcBehaviorSchema = z.enum([
  'aggressive',
  'hostile',
  'neutral',
  'friendly',
  'shopkeeper',
  'guard',
]);

const ITEM_TYPE_TUPLE = [...EQUIPMENT_SLOTS, 'consumable', 'money'] as const;
const ItemTypeSchema = z.enum(
  ITEM_TYPE_TUPLE as unknown as [ItemType, ...ItemType[]],
);

const WarpSchema = z.object({
  to: z.string().min(1),
  position: PositionSchema,
});

const BorderLinksSchema = z
  .object({
    up: WarpSchema.optional(),
    down: WarpSchema.optional(),
    left: WarpSchema.optional(),
    right: WarpSchema.optional(),
  })
  .optional();

export const TileActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('heal') }),
  z.object({ action: z.literal('kill') }),
  z.object({ action: z.literal('message'), text: z.string() }),
  z.object({ action: z.literal('sound'), file: z.string().min(1) }),
  z.object({
    action: z.literal('changeSprite'),
    spriteId: z.number().int().nonnegative(),
  }),
  z.object({ action: z.literal('script'), scriptId: z.string().min(1) }),
]);

const DoorSchema = z.object({
  requiresItem: z.number().int().nonnegative(),
  openTileIndex: z.number().int().nonnegative(),
});

export const TileSchema = z.object({
  tileIndex: z.number().int().min(-1).default(0),
  blocked: z.boolean().optional(),
  warp: WarpSchema.optional(),
  npcSpawn: z.string().optional(),
  item: z.number().optional(),
  shop: z.string().optional(),
  bank: z.boolean().optional(),
  avoidNpc: z.boolean().optional(),
  fringeIndex: z.number().int().nonnegative().optional(),
  maskIndex: z.number().int().nonnegative().optional(),
  triggers: z.array(TileActionSchema).optional(),
  door: DoorSchema.optional(),
  conditionalBlock: z.string().optional(),
});

const NpcItemDropSchema = z.object({
  itemId: z.number().int().nonnegative(),
  chance: z.number().min(0).max(1),
  quantity: z.number().int().positive().optional(),
});

const MODIFIABLE_ATTRS = [
  'health',
  'maxHealth',
  'attack',
  'strength',
  'defense',
  'agility',
  'vitality',
  'speed',
  'attackRange',
  'experience',
  'experienceToNextLevel',
  'level',
] as const;
const EFFECT_TYPES = ['add', 'multiply'] as const;

const EffectSchema = z.object({
  attribute: z.enum(
    MODIFIABLE_ATTRS as unknown as [
      ModifiablePlayerAttribute,
      ...ModifiablePlayerAttribute[],
    ],
  ),
  type: z.enum(EFFECT_TYPES as unknown as [EffectType, ...EffectType[]]),
  value: z.number(),
});

// Auth
export const LoginBodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const RegisterBodySchema = z.object({
  username: z.string().min(1).max(24),
  password: z.string().min(1),
});

// Mod
export const PlayerNameBodySchema = z.object({ playerName: z.string().min(1) });

export const ChangeSpriteBodySchema = z.object({
  spriteId: z.number().int().nonnegative(),
});

export const BanBodySchema = z.object({
  playerName: z.string().min(1),
  reason: z.string().optional(),
  until: z.number().int().positive().optional(),
});

export const SetSpriteBodySchema = z.object({
  playerName: z.string().min(1),
  spriteId: z.number().int().nonnegative(),
});

export const SetAccessBodySchema = z.object({
  playerName: z.string().min(1),
  accessLevel: AccessSchema,
});

export const GoMapBodySchema = z.object({ mapId: z.string().min(1) });

export const WarpPlayerBodySchema = z.object({
  playerName: z.string().min(1),
  mapId: z.string().min(1),
  col: z.number().int().nonnegative(),
  row: z.number().int().nonnegative(),
});

export const SetMyAccessBodySchema = z.object({ accessLevel: AccessSchema });

// Content
export const SaveMapBodySchema = z.object({
  mapId: z.string().min(1),
  tiles: z.array(z.array(TileSchema)),
  name: z.string().min(1),
  type: MapTypeSchema,
  pvp: PvpMoraleSchema.optional(),
  music: z.string().optional(),
});

export const CreateNpcBodySchema = z.object({
  name: z.string().min(1),
  sprite: z.number().int().nonnegative(),
  maxHealth: z.number().int().positive(),
  attack: z.number().int().nonnegative(),
  behavior: NpcBehaviorSchema,
  experienceValue: z.number().int().nonnegative().optional(),
  itemsToDrop: z.array(NpcItemDropSchema).optional(),
});

export const CreateMapBodySchema = z.object({
  name: z.string().min(1),
  type: MapTypeSchema,
  cols: z.number().int().min(1).max(200).optional(),
  rows: z.number().int().min(1).max(200).optional(),
});

export const UpdateMapBodySchema = z.object({
  name: z.string().min(1).optional(),
  type: MapTypeSchema.optional(),
  pvp: PvpMoraleSchema.optional(),
  music: z.string().optional(),
  borderLinks: BorderLinksSchema,
});

export const CreateSpellBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  sprite: z.number().int().nonnegative(),
  mpCost: z.number().int().nonnegative().default(0),
  damage: z.number().int().nonnegative().default(0),
  cooldownMs: z.number().int().nonnegative().default(0),
  visualTarget: z.enum(['self', 'targets']).default('self'),
});

export const ResizeMapBodySchema = z.object({
  cols: z.number().int().min(1).max(200),
  rows: z.number().int().min(1).max(200),
});

export const CreateArrowBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  sprite: z.number().int().nonnegative(),
  damage: z.number().int().nonnegative().default(0),
  rangeTiles: z.number().int().positive().optional(),
  tileSpeed: z.number().positive().optional(),
});

export const CreateItemBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  sprite: z.number().int().nonnegative(),
  type: ItemTypeSchema,
  effects: z.array(EffectSchema).optional(),
  arrowId: z.number().int().positive().optional(),
  bound: z.boolean().optional(),
});

export const BuyShopItemBodySchema = z.object({
  shopId: z.string().min(1),
  itemId: z.number().int().nonnegative(),
});

const ProductSchema = z.object({
  itemId: z.number().int().nonnegative(),
  currency: z.number().int().nonnegative(),
  price: z.number().int().nonnegative(),
});

export const CreateShopBodySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  products: z.array(ProductSchema).default([]),
});

export const ConsoleCommandBodySchema = z.object({
  line: z.string().min(1).max(500),
});

export const AssignPointsBodySchema = z.object({
  vitality: z.number().int().nonnegative().default(0),
  attack: z.number().int().nonnegative().default(0),
  strength: z.number().int().nonnegative().default(0),
  defense: z.number().int().nonnegative().default(0),
  agility: z.number().int().nonnegative().default(0),
});

export function parseBody<S extends z.ZodType>(
  schema: S,
  body: unknown,
  res: Response,
): z.output<S> | null {
  const result = schema.safeParse(body);
  if (!result.success) {
    res.status(400).json({ error: result.error.flatten() });
    return null;
  }
  return result.data;
}
