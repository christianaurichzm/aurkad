import { readFileSync } from 'fs';
import path from 'path';
import { TILE_SIZE, DEFAULT_PLAYER_SPEED } from '../shared/constants.js';
import type { Position } from '../shared/types.js';

interface PlayerConfig {
  startingAttack: number;
  startingStrength: number;
  startingDefense: number;
  startingAgility: number;
  startingMaxHealth: number;
  startingSpeed: number;
  startingInventoryCapacity: number;
}

interface LevelingConfig {
  baseXp: number;
  xpGrowthRate: number;
  pointsPerLevel: number;
}

interface WorldConfig {
  startMapId: string;
  respawnTile: { col: number; row: number };
}

interface CombatConfig {
  playerAttackCooldownMs: number;
  npcAttackCooldownMs: number;
  regenIntervalMs: number;
  regenPercent: number;
  minRegen: number;
  npcUpdateIntervalMs: number;
  baseDamageMultiplier: number;
  strengthDamageMultiplier: number;
  defenseDamageReduction: number;
  minimumDamage: number;
}

export interface ModuleConfigEntry {
  enabled?: boolean;
  config?: Record<string, unknown>;
}

export interface GameConfig {
  player: PlayerConfig;
  leveling: LevelingConfig;
  world: WorldConfig;
  combat: CombatConfig;
  // Per-module toggle + config overrides, keyed by module id.
  modules: Record<string, ModuleConfigEntry>;
}

const defaults: GameConfig = {
  player: {
    startingAttack: 100,
    startingStrength: 0,
    startingDefense: 0,
    startingAgility: 0,
    startingMaxHealth: 100,
    startingSpeed: DEFAULT_PLAYER_SPEED,
    startingInventoryCapacity: 10,
  },
  leveling: {
    baseXp: 100,
    xpGrowthRate: 1.5,
    pointsPerLevel: 5,
  },
  world: {
    startMapId: '1',
    respawnTile: { col: 9, row: 6 },
  },
  combat: {
    playerAttackCooldownMs: 250,
    npcAttackCooldownMs: 900,
    regenIntervalMs: 5000,
    regenPercent: 0.01,
    minRegen: 1,
    npcUpdateIntervalMs: 1250,
    baseDamageMultiplier: 1,
    strengthDamageMultiplier: 1,
    defenseDamageReduction: 1,
    minimumDamage: 1,
  },
  modules: {},
};

function loadGameJson(): Partial<GameConfig> {
  try {
    const raw = readFileSync(
      path.join(process.cwd(), 'game.json'),
      'utf-8',
    );
    return JSON.parse(raw) as Partial<GameConfig>;
  } catch {
    return {};
  }
}

function merge(overrides: Partial<GameConfig>): GameConfig {
  return {
    player: { ...defaults.player, ...overrides.player },
    leveling: { ...defaults.leveling, ...overrides.leveling },
    world: { ...defaults.world, ...overrides.world },
    combat: { ...defaults.combat, ...overrides.combat },
    modules: { ...defaults.modules, ...overrides.modules },
  };
}

export const gameConfig: GameConfig = merge(loadGameJson());

export const respawnPosition: Position = {
  x: gameConfig.world.respawnTile.col * TILE_SIZE,
  y: gameConfig.world.respawnTile.row * TILE_SIZE,
};
