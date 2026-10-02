/**
 * Validation of game.json.
 *
 * A syntax error, a misspelled key or a string where a number belongs has to
 * fail loudly: falling back to the built-in defaults leaves a creator who
 * changed a value seeing nothing happen in game, with nowhere to look. Also
 * pins the merge behaviour that makes partial files safe to write.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadGameConfig } from './gameConfig.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gameconfig-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const write = (contents: unknown) =>
  fs.writeFileSync(
    path.join(dir, 'game.json'),
    typeof contents === 'string' ? contents : JSON.stringify(contents),
  );

describe('defaults', () => {
  // The state a fresh clone starts in.
  it('runs on defaults when there is no file', () => {
    const config = loadGameConfig(dir);

    expect(config.player.startingMaxHealth).toBe(100);
    expect(config.world.respawnTile).toEqual({ col: 9, row: 6 });
    expect(config.modules).toEqual({});
  });

  it('keeps the rest of a section when one value is set', () => {
    write({ player: { startingMaxHealth: 250 } });

    const config = loadGameConfig(dir);

    expect(config.player.startingMaxHealth).toBe(250);
    expect(config.player.startingInventoryCapacity).toBe(10);
  });

  // A shallow merge would drop `row` here, and an undefined row becomes NaN the
  // moment it is multiplied into a position.
  it('keeps the rest of a nested object too', () => {
    write({ world: { respawnTile: { col: 5 } } });

    expect(loadGameConfig(dir).world.respawnTile).toEqual({ col: 5, row: 6 });
  });
});

describe('a file that cannot be trusted', () => {
  it('refuses to boot on broken JSON instead of pretending it is absent', () => {
    write('{ "player": { "startingAttack": 10, } }');

    expect(() => loadGameConfig(dir)).toThrow(/not valid JSON/);
  });

  // A key that does nothing looks exactly like a setting with no effect.
  it('refuses a key nobody reads', () => {
    write({ player: { startingHealth: 250 } });

    expect(() => loadGameConfig(dir)).toThrow(/startingHealth/);
  });

  it('refuses a misspelled section', () => {
    write({ combatt: {} });

    expect(() => loadGameConfig(dir)).toThrow(/combatt/);
  });

  it('refuses a value of the wrong type', () => {
    write({ player: { startingMaxHealth: '250' } });

    expect(() => loadGameConfig(dir)).toThrow(/startingMaxHealth/);
  });

  // Ranges are where a value is the right type and still breaks the game.
  it('refuses a starting health of zero, which is a dead character', () => {
    write({ player: { startingMaxHealth: 0 } });

    expect(() => loadGameConfig(dir)).toThrow(/startingMaxHealth/);
  });

  it('takes a bag of zero, a game with no inventory, but not less', () => {
    write({ player: { startingInventoryCapacity: 0 } });
    expect(loadGameConfig(dir).player.startingInventoryCapacity).toBe(0);
    write({ player: { startingInventoryCapacity: -1 } });
    expect(() => loadGameConfig(dir)).toThrow(/startingInventoryCapacity/);
  });

  it('refuses a growth rate that never grows', () => {
    write({ leveling: { xpGrowthRate: 1 } });

    expect(() => loadGameConfig(dir)).toThrow(/xpGrowthRate/);
  });

  it('refuses a minimum damage below one, which never ends a fight', () => {
    write({ combat: { minimumDamage: 0 } });

    expect(() => loadGameConfig(dir)).toThrow(/minimumDamage/);
  });

  it('refuses a regen interval of zero', () => {
    write({ combat: { regenIntervalMs: 0 } });

    expect(() => loadGameConfig(dir)).toThrow(/regenIntervalMs/);
  });

  // One boot per typo would be its own kind of unhelpful.
  it('lists every problem at once', () => {
    write({
      player: { startingMaxHealth: 0, startingSpeed: -1 },
      leveling: { xpGrowthRate: 0.5 },
    });

    const message = (() => {
      try {
        loadGameConfig(dir);
        return '';
      } catch (e) {
        return (e as Error).message;
      }
    })();

    expect(message).toContain('startingMaxHealth');
    expect(message).toContain('startingSpeed');
    expect(message).toContain('xpGrowthRate');
  });

  it('points at the file that documents the keys', () => {
    write({ nonsense: true });

    expect(() => loadGameConfig(dir)).toThrow(/game.example.json/);
  });
});

describe('brand', () => {
  it('is the engine until the game names itself', () => {
    expect(loadGameConfig(dir).brand).toEqual({ name: 'Aurkad' });
  });

  it('refuses a blank name, which would leave the tab and the card empty', () => {
    write({ brand: { name: '   ' } });

    expect(() => loadGameConfig(dir)).toThrow(/brand\.name/);
  });
});

describe('modules', () => {
  // Unknown keys here are module ids, not typos, so strictness stops here;
  // the config inside belongs to the module.
  it('accepts any module id with any config', () => {
    write({
      modules: {
        bank: { enabled: true, config: { maxSlots: 99 } },
        somethingNew: { enabled: false },
      },
    });

    const config = loadGameConfig(dir);

    expect(config.modules['bank']).toEqual({
      enabled: true,
      config: { maxSlots: 99 },
    });
    expect(config.modules['somethingNew']?.enabled).toBe(false);
  });

  it('still refuses a misspelled field on a module entry', () => {
    write({ modules: { bank: { enable: true } } });

    expect(() => loadGameConfig(dir)).toThrow(/enable/);
  });
});

describe('the repository game.json', () => {
  // The file shipped with the engine has to satisfy the schema it ships with.
  it('is valid', () => {
    expect(() => loadGameConfig(process.cwd())).not.toThrow();
  });

  it('matches game.example.json, so the example does not drift', () => {
    const example = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'game.example.json'), 'utf-8'),
    );
    fs.writeFileSync(
      path.join(dir, 'game.json'),
      JSON.stringify(example, null, 2),
    );

    expect(() => loadGameConfig(dir)).not.toThrow();
    // Every section the schema knows about appears in the example.
    expect(Object.keys(example).sort()).toEqual([
      'brand',
      'combat',
      'leveling',
      'modules',
      'player',
      'world',
    ]);
  });
});
