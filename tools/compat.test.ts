// @vitest-environment node
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  bumpBetween,
  moduleBreaks,
  requiredBump,
  scriptApiBreaks,
} from './compat.js';

describe('scriptApiBreaks', () => {
  // The declaration files hold the kinds of type the check has to see past
  // (branded interfaces, generic conditional aliases), so a release compared
  // with itself is the case that catches a false alarm before a release does.
  it('finds nothing between the current declaration files and themselves', () => {
    const api = ['scripts/global.d.ts', 'modules/clientEngine.d.ts']
      .map((f) => fs.readFileSync(f, 'utf8'))
      .join('\n');
    expect(scriptApiBreaks(api, api)).toEqual([]);
  }, 20_000);

  const api = `
    interface PlayerServer { name: string; level: number }
    interface HookPayloads { playerJoin: { player: PlayerServer; first: boolean } }
    declare function on<E extends keyof HookPayloads>(
      event: E,
      handler: (payload: HookPayloads[E]) => void,
    ): () => void;
    declare function getPlayer(name: string): PlayerServer | undefined;
    interface SpawnOptions { mapId: string; name?: string }
    declare function spawn(opts: SpawnOptions): void;
  `;
  const change = (from: string | RegExp, to: string) => {
    const changed = api.replace(from, to);
    expect(changed).not.toBe(api);
    return scriptApiBreaks(api, changed);
  };

  it.each([
    [
      'a new global',
      'declare function spawn',
      'declare function despawn(): void;\ndeclare function spawn',
    ],
    [
      'a new optional parameter',
      'getPlayer(name: string)',
      'getPlayer(name: string, mapId?: string)',
    ],
    [
      'a new field on what the engine hands over',
      'level: number',
      'level: number; guild?: string',
    ],
    [
      'a new optional option',
      'name?: string',
      'name?: string; sprite?: number',
    ],
  ])('accepts %s', (_, from, to) => {
    expect(change(from, to)).toEqual([]);
  });

  it.each([
    [
      'a removed global',
      'declare function spawn(opts: SpawnOptions): void;',
      '',
      /spawn was removed/,
    ],
    [
      'a renamed type',
      /SpawnOptions/g,
      'NpcOptions',
      /type SpawnOptions was removed/,
    ],
    [
      'a new required parameter',
      'getPlayer(name: string)',
      'getPlayer(name: string, mapId: string)',
      /^getPlayer:/,
    ],
    [
      'a return that can now be missing',
      '): () => void;',
      '): (() => void) | undefined;',
      /^on:/,
    ],
    [
      'a field removed from what the engine hands over',
      'level: number',
      'rank: number',
      /level/,
    ],
    ['a field removed from a hook payload', '; first: boolean', '', /first/],
    [
      'a new required option',
      'name?: string',
      'name?: string; sprite: number',
      /^spawn:/,
    ],
  ] as const)('reports %s', (_, from, to, reported) => {
    expect(change(from, to).join('\n')).toMatch(reported);
  });
});

describe('moduleBreaks', () => {
  const before = { quest: {}, weather: { enabledByDefault: false } };

  it('lets a new module in when it starts switched off', () => {
    expect(
      moduleBreaks(before, { ...before, fishing: { enabledByDefault: false } }),
    ).toEqual([]);
  });

  it.each([
    ['a new module on by default', { ...before, fishing: {} }, 'fishing'],
    [
      'a default that flipped',
      { ...before, weather: { enabledByDefault: true } },
      'weather',
    ],
    ['a removed module', { weather: before.weather }, 'quest'],
  ])('reports %s', (_, after, id) => {
    const breaks = moduleBreaks(before, after);
    expect(breaks).toHaveLength(1);
    expect(breaks[0]).toContain(`module ${id} `);
  });
});

describe('the version a release needs', () => {
  it('is a major past a breaking change and a minor past a schema bump', () => {
    const report = { breaks: [], composeChanged: true };
    expect(requiredBump(report)).toBe('patch');
    expect(requiredBump({ ...report, schema: { from: 2, to: 3 } })).toBe(
      'minor',
    );
    expect(requiredBump({ ...report, breaks: ['x was removed'] })).toBe(
      'major',
    );
  });

  it('reads the bump off the two versions', () => {
    expect(bumpBetween('v1.4.2', '1.4.3')).toBe('patch');
    expect(bumpBetween('v1.4.2', '1.5.0')).toBe('minor');
    expect(bumpBetween('v1.4.2', '2.0.0')).toBe('major');
  });
});
