import { z } from 'zod';
import type { Response } from 'express';
import {
  Access,
  type ItemType,
  type ModifiablePlayerAttribute,
  type EffectType,
} from '../../shared/types.js';
import {
  EQUIPMENT_SLOTS,
  PASSWORD_MIN_LENGTH,
} from '../../shared/constants.js';
import { SCRIPT_PARAM_LIMITS } from '../../shared/scriptParams.js';

const PositionSchema = z.object({ x: z.number(), y: z.number() });

/**
 * Values a designer filled in for a behaviour's declared params, bounded:
 * this lands in a Mixed Mongoose field loaded on every content read. Keys
 * are checked against the declaration in contentValidation and undeclared
 * ones dropped at dispatch; this only keeps the blob small.
 */
export const ScriptParamsSchema = z
  .record(
    z.string().min(1).max(SCRIPT_PARAM_LIMITS.maxKeyLength),
    z.union([
      z.string().max(SCRIPT_PARAM_LIMITS.maxStringLength),
      z.number().finite(),
      z.boolean(),
    ]),
  )
  .refine(
    (params) => Object.keys(params).length <= SCRIPT_PARAM_LIMITS.maxKeys,
    `at most ${SCRIPT_PARAM_LIMITS.maxKeys} script params`,
  );
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

export const BorderLinksSchema = z
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
  z.object({
    action: z.literal('script'),
    scriptId: z.string().min(1),
    scriptParams: ScriptParamsSchema.optional(),
  }),
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

// A new password, wherever it is being set. Registration keeps its own rule on
// purpose: raising the bar for existing deployments is a policy decision, not
// something a reset flow should smuggle in.
const NewPassword = z.string().min(PASSWORD_MIN_LENGTH).max(200);

export const ChangePasswordBodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: NewPassword,
});

export const ResetRequestBodySchema = z.object({
  username: z.string().min(1).max(24),
});

export const ResetConfirmBodySchema = z.object({
  token: z.string().min(1).max(200),
  newPassword: NewPassword,
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
  lootTableId: z.string().optional(),
  dialogId: z.string().optional(),
  // Declared here or the field never reaches mongoose: z.object strips what it
  // does not know, so the editor would save and the npc would come back
  // without the quest it offers.
  questId: z.string().optional(),
  scriptId: z.string().optional(),
  scriptParams: ScriptParamsSchema.optional(),
  // AI tuning in tiles. Clamped here rather than defaulted: absent has to stay
  // absent so the engine default for the behaviour keeps applying, and a sight
  // of 200 tiles would make every npc query the whole map.
  sight: z.number().int().min(1).max(20).optional(),
  pathDepth: z.number().int().min(0).max(40).optional(),
  leash: z.number().int().min(0).max(60).optional(),
  // Milliseconds between steps. Floored at one tick at 20 Hz; a minute is
  // already a statue that twitches.
  moveIntervalMs: z.number().int().min(50).max(60_000).optional(),
});

/**
 * A crash in a player's browser, reported by the client.
 *
 * Every field is capped rather than merely typed: this is the one endpoint that
 * accepts free text from an unauthenticated caller and writes it to the log an
 * operator reads. A stack is long, so 4 KB; nothing useful is past that.
 */
export const ClientErrorBodySchema = z.object({
  kind: z.enum(['error', 'unhandledrejection']),
  message: z.string().min(1).max(500),
  stack: z.string().max(4000).optional(),
  /** Where in the client it happened, not where it was sent from. */
  source: z.string().max(500).optional(),
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
  scriptId: z.string().optional(),
  scriptParams: ScriptParamsSchema.optional(),
});

const LootQuantitySchema = z.union([
  z.number().int().positive(),
  z.object({
    min: z.number().int().positive(),
    max: z.number().int().positive(),
  }),
]);

const LootEntrySchema = z.object({
  itemId: z.number().int().nonnegative(),
  weight: z.number().nonnegative().optional(),
  chance: z.number().min(0).max(1).optional(),
  quantity: LootQuantitySchema.optional(),
  condition: z.string().min(1).optional(),
});

export const CreateLootTableBodySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  guaranteed: z.array(LootEntrySchema).optional(),
  rolls: z
    .object({
      min: z.number().int().nonnegative(),
      max: z.number().int().nonnegative(),
    })
    .optional(),
  entries: z.array(LootEntrySchema).optional(),
  emptyWeight: z.number().nonnegative().optional(),
});

// Bounds on an authored conversation. The values land in a document that is
// loaded whole on every server start and read from inside the tick, so the
// limits are what a designer can plausibly write rather than what JSON allows.
// Nine choices is the ceiling because the shipped dialog client binds number
// keys 1-9: a tenth option exists but cannot be picked from the keyboard.
const DialogChoiceSchema = z.object({
  label: z.string().min(1).max(120),
  next: z.string().min(1).max(64).optional(),
  condition: z.string().min(1).max(64).optional(),
  action: z.string().min(1).max(64).optional(),
});

const DialogNodeSchema = z.object({
  id: z.string().min(1).max(64),
  text: z.string().min(1).max(2000),
  choices: z.array(DialogChoiceSchema).max(9).optional(),
});

export const CreateDialogBodySchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  start: z.string().min(1).max(64).optional(),
  nodes: z.array(DialogNodeSchema).min(1).max(100),
});

// A discriminated union, so "kill" cannot be saved with a mapId and "reach"
// cannot be saved without one; with every field optional, an objective
// nothing can complete could be authored.
const QuestObjectiveSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('kill'),
    npcId: z.string().min(1).max(64),
    count: z.number().int().positive().max(10_000),
  }),
  z.object({
    type: z.literal('collect'),
    itemId: z.number().int().nonnegative(),
    count: z.number().int().positive().max(10_000),
  }),
  z.object({ type: z.literal('talk'), npcId: z.string().min(1).max(64) }),
  z.object({
    type: z.literal('reach'),
    mapId: z.string().min(1).max(64),
    row: z.number().int().nonnegative(),
    col: z.number().int().nonnegative(),
  }),
]);

export const CreateQuestBodySchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  objective: QuestObjectiveSchema,
  reward: z
    .object({
      experience: z.number().int().nonnegative().optional(),
      items: z
        .array(
          z.object({
            itemId: z.number().int().nonnegative(),
            quantity: z.number().int().positive(),
          }),
        )
        .max(20)
        .optional(),
      script: z.string().min(1).max(64).optional(),
    })
    .optional(),
});

const RecipeIngredientSchema = z.object({
  itemId: z.number().int().nonnegative(),
  quantity: z.number().int().positive().max(10_000),
});

export const CreateRecipeBodySchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  // At least one input: a recipe that consumes nothing produces items from
  // thin air, which is the one thing the economy is not allowed to do.
  inputs: z.array(RecipeIngredientSchema).min(1).max(20),
  output: RecipeIngredientSchema,
  condition: z.string().min(1).max(64).optional(),
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

// Scripts (Monaco editor)
export const ScriptContentBodySchema = z.object({
  content: z.string().max(500_000),
});

export const CreateScriptBodySchema = z.object({
  name: z.string().min(1).max(120),
  content: z.string().max(500_000).optional(),
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
