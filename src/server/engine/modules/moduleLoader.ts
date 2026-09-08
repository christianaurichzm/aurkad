import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { logger } from '../../logger.js';
import { gameConfig } from '../../gameConfig.js';
import { runInSandbox, type ScriptHandle } from '../scripting/sandbox.js';
import {
  isModuleEnabled,
  resolveModuleConfig,
  orderModules,
  type ModuleManifest,
} from './moduleResolver.js';

// Loads official/optional modules from modules/<id>/. Each module is a manifest
// (module.json) plus at least one entry: a .js server entry that runs in the
// SAME sandbox as game scripts, with its merged config injected as a `config`
// global, and/or a browser entry served to the client. Toggled and configured
// via game.json's `modules` section.

const modulesDir = (): string =>
  process.env.MODULES_PATH
    ? path.resolve(process.env.MODULES_PATH)
    : path.join(process.cwd(), 'modules');

const ManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  // One of the two is required; the check is in the loader, where the missing
  // file can be named in the log.
  server: z.string().min(1).optional(),
  client: z.string().min(1).optional(),
  description: z.string().optional(),
  enabledByDefault: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  dependencies: z.array(z.string()).optional(),
});

const handles = new Map<string, ScriptHandle>();
// Manifests of successfully loaded modules, for serving client entries.
const loadedManifests = new Map<string, ModuleManifest>();

function readManifests(dir: string): ModuleManifest[] {
  const manifests: ModuleManifest[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(dir, entry.name, 'module.json');
    if (!fs.existsSync(manifestPath)) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch (e) {
      logger.error(`[modules] Invalid JSON in ${entry.name}/module.json`, {
        err: e,
      });
      continue;
    }
    const parsed = ManifestSchema.safeParse(raw);
    if (!parsed.success) {
      logger.error(`[modules] Invalid manifest in ${entry.name}`, {
        issues: parsed.error.issues.map(
          (i) => `${i.path.join('.')}: ${i.message}`,
        ),
      });
      continue;
    }
    manifests.push(parsed.data);
  }
  return manifests;
}

export function loadModules(): void {
  const dir = modulesDir();
  if (!fs.existsSync(dir)) {
    logger.info('[modules] No modules/ directory - skipping');
    return;
  }

  loadedManifests.clear();
  const all = readManifests(dir);
  const enabled = all.filter((m) => isModuleEnabled(m, gameConfig.modules));
  const ordered = orderModules(enabled);

  const skipped = all.length - enabled.length;
  logger.info(`[modules] ${enabled.length} enabled, ${skipped} disabled`);

  const loaded = new Set<string>();

  for (const manifest of ordered) {
    const missingDep = (manifest.dependencies ?? []).find(
      (d) => !loaded.has(d),
    );
    if (missingDep) {
      logger.error(
        `[modules] ${manifest.id}: skipped - dependency "${missingDep}" is not loaded`,
      );
      continue;
    }

    // A module with no server entry only draws (a minimap, a day/night tint).
    // It is still listed, toggled and configured like the rest, with nothing
    // to run in the sandbox.
    if (manifest.server) {
      const entryPath = path.join(dir, manifest.id, manifest.server);
      if (!fs.existsSync(entryPath)) {
        logger.error(
          `[modules] ${manifest.id}: entry not found: ${manifest.server}`,
        );
        continue;
      }
      let code: string;
      try {
        code = fs.readFileSync(entryPath, 'utf-8');
      } catch (e) {
        logger.error(`[modules] ${manifest.id}: failed to read entry`, {
          err: e,
        });
        continue;
      }
      const config = resolveModuleConfig(manifest, gameConfig.modules);
      const handle = runInSandbox(code, `module:${manifest.id}`, { config });
      // A module that threw on its way up registered part of itself and
      // provided nothing. Marked loaded anyway, it would let every dependent
      // run against an API that is not there, and the first symptom would
      // surface in the dependent rather than here.
      if (!handle.ok) {
        logger.error(
          `[modules] ${manifest.id}: skipped - initialization failed`,
        );
        continue;
      }
      handles.set(manifest.id, handle);
    } else if (!manifest.client) {
      logger.error(
        `[modules] ${manifest.id}: has neither a server nor a client entry`,
      );
      continue;
    }

    loadedManifests.set(manifest.id, manifest);
    loaded.add(manifest.id);
    logger.info(`[modules] Loaded ${manifest.id} v${manifest.version}`);
  }
}

export function unloadAllModules(): void {
  for (const [, handle] of handles) handle.cleanup();
  handles.clear();
  loadedManifests.clear();
}

// Loaded modules that ship a browser entry, for the client loader.
export function getClientModules(): { id: string; client: string }[] {
  return [...loadedManifests.values()]
    .filter((m): m is ModuleManifest & { client: string } => !!m.client)
    .map((m) => ({ id: m.id, client: m.client }));
}

// Reads a loaded module's declared client file. Returns null if the module
// isn't loaded or has no client entry; resolves strictly within the module dir.
export function readModuleClientFile(id: string): string | null {
  const manifest = loadedManifests.get(id);
  if (!manifest?.client) return null;
  const moduleDir = path.resolve(modulesDir(), id);
  const filePath = path.resolve(moduleDir, manifest.client);
  if (filePath !== moduleDir && !filePath.startsWith(moduleDir + path.sep)) {
    return null; // traversal guard: must stay within the module dir
  }
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf-8');
}
