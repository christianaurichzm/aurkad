import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { TILE_SIZE, DEFAULT_PLAYER_SPEED } from '../shared/constants.js';
import type { Position } from '../shared/types.js';
import { gamePath } from './config.js';

// Gameplay configuration: what a creator tunes without touching code. The
// deployment's settings (ports, limits, feature flags) come from the
// environment in config.ts.
//
// Validated, not merged blindly: a syntax error, a misspelled key or a
// string where a number belongs stops the boot with every problem listed,
// rather than leaving defaults in force with nowhere to look. Defaults are
// per field through `prefault`, so `respawnTile: { col: 5 }` keeps the
// default `row` instead of a NaN position.

const ModuleEntrySchema = z.strictObject({
  enabled: z.boolean().optional(),
  // Free-form: the shape belongs to the module, which validates its
  // own config when it loads.
  config: z.record(z.string(), z.unknown()).optional(),
});

const PlayerSchema = z
  .strictObject({
    startingAttack: z.number().min(0).default(100),
    startingStrength: z.number().min(0).default(0),
    startingDefense: z.number().min(0).default(0),
    startingAgility: z.number().min(0).default(0),
    // Zero max health means a character that is dead the moment it is created.
    startingMaxHealth: z.number().positive().default(100),
    startingSpeed: z.number().positive().default(DEFAULT_PLAYER_SPEED),
    startingInventoryCapacity: z.number().int().positive().default(10),
  })
  .prefault({});

const LevelingSchema = z
  .strictObject({
    baseXp: z.number().positive().default(100),
    // At or below 1 the curve never rises, so every level costs the same and
    // the last one arrives in seconds.
    xpGrowthRate: z.number().gt(1).default(1.5),
    pointsPerLevel: z.number().int().min(0).default(5),
  })
  .prefault({});

const WorldSchema = z
  .strictObject({
    startMapId: z.string().min(1).default('1'),
    respawnTile: z
      .strictObject({
        col: z.number().int().min(0).default(9),
        row: z.number().int().min(0).default(6),
      })
      .prefault({}),
    // How long an empty copy of an instanced map (a dungeon) is kept before
    // it is closed; which maps are instanced is set on each map. Not zero, so
    // a dropped connection can walk back into the same run.
    instanceGraceMs: z.number().int().min(0).default(60_000),
  })
  .prefault({});

const CombatSchema = z
  .strictObject({
    playerAttackCooldownMs: z.number().int().min(0).default(250),
    npcAttackCooldownMs: z.number().int().min(0).default(900),
    // A regen tick every 0ms is an infinite loop's worth of scheduling.
    regenIntervalMs: z.number().int().positive().default(5000),
    regenPercent: z.number().min(0).max(1).default(0.01),
    minRegen: z.number().min(0).default(1),
    npcUpdateIntervalMs: z.number().int().positive().default(1250),
    baseDamageMultiplier: z.number().min(0).default(1),
    strengthDamageMultiplier: z.number().min(0).default(1),
    defenseDamageReduction: z.number().min(0).default(1),
    // Below 1 a fight between evenly matched characters never ends.
    minimumDamage: z.number().min(1).default(1),
  })
  .prefault({});

// Who the game is to someone who has not logged in yet: the name on the browser
// tab and the login card, and the picture beside it. The rest of the look is
// theme/theme.css, served next to it (gameRoutes).
const BrandSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(40).default('Aurkad'),
    // A file in theme/, so it is public: the login screen shows it before
    // there is a session to check.
    logo: z.string().min(1).optional(),
  })
  .prefault({});

const GameConfigSchema = z
  .strictObject({
    brand: BrandSchema,
    player: PlayerSchema,
    leveling: LevelingSchema,
    world: WorldSchema,
    combat: CombatSchema,
    // Keyed by module id, so unknown keys here are modules, not typos.
    modules: z.record(z.string(), ModuleEntrySchema).prefault({}),
  })
  .prefault({});

export type GameConfig = z.infer<typeof GameConfigSchema>;
export type ModuleConfigEntry = z.infer<typeof ModuleEntrySchema>;

const GAME_CONFIG_FILE = 'game.json';

function fail(reason: string): never {
  throw new Error(
    `[gameConfig] ${GAME_CONFIG_FILE} is invalid, so the game would run with ` +
      `settings nobody chose:\n${reason}\n` +
      `See game.example.json for every key and its default.`,
  );
}

/**
 * Reads and validates game.json. A missing file means all defaults, as in a
 * fresh clone; a file that cannot be understood fails, since somebody wrote
 * it meaning to change something.
 */
export function loadGameConfig(dir = gamePath()): GameConfig {
  let raw: string;
  try {
    raw = readFileSync(path.join(dir, GAME_CONFIG_FILE), 'utf-8');
  } catch {
    return GameConfigSchema.parse(undefined);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    fail(`  not valid JSON: ${(e as Error).message}`);
  }

  const result = GameConfigSchema.safeParse(parsed);
  if (!result.success) {
    // Every problem at once. Reporting the first would mean one boot per typo.
    fail(
      result.error.issues
        .map(
          (issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`,
        )
        .join('\n'),
    );
  }

  return result.data;
}

export const gameConfig: GameConfig = loadGameConfig();

export const respawnPosition: Position = {
  x: gameConfig.world.respawnTile.col * TILE_SIZE,
  y: gameConfig.world.respawnTile.row * TILE_SIZE,
};
