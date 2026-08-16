import type { ModuleConfigEntry } from '../../gameConfig.js';

// Pure module-resolution logic (no filesystem, no sandbox), so the rules for
// "is this enabled?", "what's the effective config?", and "what order?" are
// unit-testable on their own.

export interface ModuleManifest {
  id: string;
  name: string;
  version: string;
  // Server entry, relative to the module dir. Absent for a module that only
  // draws (a minimap, a day/night tint): it has a client entry and nothing to
  // run in the sandbox. One of the two is required.
  server?: string;
  client?: string; // optional browser entry, served to clients
  description?: string;
  enabledByDefault?: boolean;
  config?: Record<string, unknown>;
  dependencies?: string[];
}

type GameModules = Record<string, ModuleConfigEntry>;

// game.json wins; otherwise the manifest default; otherwise on.
export function isModuleEnabled(
  manifest: ModuleManifest,
  gameModules: GameModules,
): boolean {
  const override = gameModules[manifest.id]?.enabled;
  if (override !== undefined) return override;
  return manifest.enabledByDefault ?? true;
}

// Manifest defaults overlaid with game.json overrides (shallow).
export function resolveModuleConfig(
  manifest: ModuleManifest,
  gameModules: GameModules,
): Record<string, unknown> {
  return {
    ...(manifest.config ?? {}),
    ...(gameModules[manifest.id]?.config ?? {}),
  };
}

// Orders modules so each loads after its dependencies. Deterministic (id sort),
// tolerant of missing deps and cycles (a cycle just breaks at the repeat).
export function orderModules(manifests: ModuleManifest[]): ModuleManifest[] {
  const byId = new Map(manifests.map((m) => [m.id, m]));
  const result: ModuleManifest[] = [];
  const done = new Set<string>();
  const onStack = new Set<string>();

  const visit = (m: ModuleManifest): void => {
    if (done.has(m.id) || onStack.has(m.id)) return;
    onStack.add(m.id);
    for (const dep of m.dependencies ?? []) {
      const depMod = byId.get(dep);
      if (depMod) visit(depMod);
    }
    onStack.delete(m.id);
    done.add(m.id);
    result.push(m);
  };

  [...manifests].sort((a, b) => a.id.localeCompare(b.id)).forEach(visit);
  return result;
}
