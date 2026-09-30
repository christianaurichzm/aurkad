// Inter-module API registry. A module (or script) calls provide(name, api) to
// publish an API object; others call use(name) to consume it. This is what lets
// modules build on each other (and lets scripts use module features) instead of
// every capability being a hardcoded global.

const provides = new Map<string, unknown>();

export function provideApi(name: string, api: unknown): () => void {
  provides.set(name, api);
  return () => {
    if (provides.get(name) === api) provides.delete(name);
  };
}

export function useApi<T = unknown>(name: string): T | undefined {
  return provides.get(name) as T | undefined;
}

export function isProvided(name: string): boolean {
  return provides.has(name);
}

// The part after `prefix` of every name provided under it, e.g. the
// `questStart` of `dialogAction.questStart`.
export function providedNames(prefix: string): string[] {
  return [...provides.keys()]
    .filter((name) => name.startsWith(prefix))
    .map((name) => name.slice(prefix.length));
}

// Test helper.
export function clearProvides(): void {
  provides.clear();
}
