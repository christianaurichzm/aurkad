import { describe, it, expect } from 'vitest';
import {
  isModuleEnabled,
  resolveModuleConfig,
  orderModules,
  type ModuleManifest,
} from './moduleResolver.js';

const mod = (over: Partial<ModuleManifest> & { id: string }): ModuleManifest => ({
  name: over.id,
  version: '1.0.0',
  server: 'server.js',
  ...over,
});

describe('isModuleEnabled', () => {
  it('defaults to enabled when nothing is specified', () => {
    expect(isModuleEnabled(mod({ id: 'a' }), {})).toBe(true);
  });

  it('honors enabledByDefault when game.json is silent', () => {
    expect(isModuleEnabled(mod({ id: 'a', enabledByDefault: false }), {})).toBe(false);
  });

  it('game.json override wins over the manifest default', () => {
    expect(isModuleEnabled(mod({ id: 'a', enabledByDefault: false }), { a: { enabled: true } })).toBe(true);
    expect(isModuleEnabled(mod({ id: 'a', enabledByDefault: true }), { a: { enabled: false } })).toBe(false);
  });
});

describe('resolveModuleConfig', () => {
  it('uses manifest defaults when there is no override', () => {
    expect(resolveModuleConfig(mod({ id: 'g', config: { maxMembers: 50 } }), {})).toEqual({
      maxMembers: 50,
    });
  });

  it('overlays game.json config over the manifest defaults', () => {
    const m = mod({ id: 'g', config: { maxMembers: 50, motd: 'hi' } });
    expect(resolveModuleConfig(m, { g: { config: { maxMembers: 100 } } })).toEqual({
      maxMembers: 100,
      motd: 'hi',
    });
  });

  it('is empty when neither side defines config', () => {
    expect(resolveModuleConfig(mod({ id: 'g' }), {})).toEqual({});
  });
});

describe('orderModules', () => {
  it('loads dependencies before dependents', () => {
    const a = mod({ id: 'a', dependencies: ['b'] });
    const b = mod({ id: 'b' });
    const order = orderModules([a, b]).map((m) => m.id);
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('a'));
  });

  it('is deterministic (id sorted) with no dependencies', () => {
    const order = orderModules([mod({ id: 'c' }), mod({ id: 'a' }), mod({ id: 'b' })]);
    expect(order.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('tolerates a dependency cycle without looping forever', () => {
    const a = mod({ id: 'a', dependencies: ['b'] });
    const b = mod({ id: 'b', dependencies: ['a'] });
    const order = orderModules([a, b]).map((m) => m.id);
    expect(order.sort()).toEqual(['a', 'b']);
  });

  it('ignores missing dependencies', () => {
    const a = mod({ id: 'a', dependencies: ['ghost'] });
    expect(orderModules([a]).map((m) => m.id)).toEqual(['a']);
  });
});
