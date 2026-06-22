import { describe, it, expect, beforeEach } from 'vitest';
import { provideApi, useApi, isProvided, clearProvides } from './registry.js';

beforeEach(() => clearProvides());

describe('inter-module registry', () => {
  it('use returns what provide published', () => {
    provideApi('dialog', { show: () => 'shown' });
    expect(useApi<{ show: () => string }>('dialog')?.show()).toBe('shown');
  });

  it('use returns undefined for a name nobody provided', () => {
    expect(useApi('missing')).toBeUndefined();
    expect(isProvided('missing')).toBe(false);
  });

  it('the returned disposer withdraws the API', () => {
    const dispose = provideApi('x', { a: 1 });
    expect(isProvided('x')).toBe(true);
    dispose();
    expect(isProvided('x')).toBe(false);
  });

  it('a stale disposer does not remove a newer provider of the same name', () => {
    const disposeOld = provideApi('x', { v: 1 });
    provideApi('x', { v: 2 }); // replaces
    disposeOld(); // should NOT delete the v2 provider
    expect(useApi<{ v: number }>('x')?.v).toBe(2);
  });
});
