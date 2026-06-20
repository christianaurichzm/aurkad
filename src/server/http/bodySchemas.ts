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
const NpcBehaviorSchema = z.enum(['aggressive', 'hostile', 'neutral']);

const ITEM_TYPE_TUPLE = [...EQUIPMENT_SLOTS, 'consumable', 'money'] as const;
const ItemTypeSchema = z.enum(
  ITEM_TYPE_TUPLE as unknown as [ItemType, ...ItemType[]],
);

const WarpSchema = z.object({
  to: z.string().min(1),
  position: PositionSchema,
});

const TileSchema = z.object({
  tileIndex: z.number().int().nonnegative().default(0),
  blocked: z.boolean().optional(),
  warp: WarpSchema.optional(),
  npcSpawn: z.string().optional(),
  item: z.number().optional(),
  shop: z.string().optional(),
  avoidNpc: z.boolean().optional(),
  fringe: z.boolean().optional(),
});

const NpcItemDropSchema = z.object({
  itemId: z.number().int().nonnegative(),
  chance: z.number().min(0).max(1),
});

const MODIFIABLE_ATTRS = [
  'health',
  'maxHealth',
  'attack',
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

export const SetMyAccessBodySchema = z.object({ accessLevel: AccessSchema });

// Content
export const SaveMapBodySchema = z.object({
  mapId: z.string().min(1),
  tiles: z.array(z.array(TileSchema)),
  name: z.string().min(1),
  type: MapTypeSchema,
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
});

export const UpdateMapBodySchema = z.object({
  name: z.string().min(1).optional(),
  type: MapTypeSchema.optional(),
});

export const CreateItemBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  sprite: z.number().int().nonnegative(),
  type: ItemTypeSchema,
  effects: z.array(EffectSchema).optional(),
});

export const BuyShopItemBodySchema = z.object({
  shopId: z.string().min(1),
  itemId: z.number().int().nonnegative(),
});

export const AssignPointsBodySchema = z.object({
  vitality: z.number().int().nonnegative().default(0),
  attack: z.number().int().nonnegative().default(0),
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
