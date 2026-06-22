import fs from 'fs';
import path from 'path';
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
// (module.json) plus a .js server entry that runs in the SAME sandbox as game
// scripts, with its merged config injected as a `config` global. Toggled and
// configured via game.json's `modules` section.

const modulesDir = (): string =>
  process.env.MODULES_PATH
    ? path.resolve(process.env.MODULES_PATH)
    : path.join(process.cwd(), 'modules');

const ManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  server: z.string().min(1),
  description: z.string().optional(),
  enabledByDefault: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  dependencies: z.array(z.string()).optional(),
});

const handles = new Map<string, ScriptHandle>();

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
      logger.error(`[modules] Invalid JSON in ${entry.name}/module.json`, { err: e });
      continue;
    }
    const parsed = ManifestSchema.safeParse(raw);
    if (!parsed.success) {
      logger.error(`[modules] Invalid manifest in ${entry.name}`, {
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
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

  const all = readManifests(dir);
  const enabled = all.filter((m) => isModuleEnabled(m, gameConfig.modules));
  const ordered = orderModules(enabled);

  const skipped = all.length - enabled.length;
  logger.info(`[modules] ${enabled.length} enabled, ${skipped} disabled`);

  const loaded = new Set<string>();

  for (const manifest of ordered) {
    const missingDep = (manifest.dependencies ?? []).find((d) => !loaded.has(d));
    if (missingDep) {
      logger.error(
        `[modules] ${manifest.id}: skipped - dependency "${missingDep}" is not loaded`,
      );
      continue;
    }

    const entryPath = path.join(dir, manifest.id, manifest.server);
    if (!fs.existsSync(entryPath)) {
      logger.error(`[modules] ${manifest.id}: entry not found: ${manifest.server}`);
      continue;
    }
    let code: string;
    try {
      code = fs.readFileSync(entryPath, 'utf-8');
    } catch (e) {
      logger.error(`[modules] ${manifest.id}: failed to read entry`, { err: e });
      continue;
    }
    const config = resolveModuleConfig(manifest, gameConfig.modules);
    const handle = runInSandbox(code, `module:${manifest.id}`, { config });
    handles.set(manifest.id, handle);
    loaded.add(manifest.id);
    logger.info(`[modules] Loaded ${manifest.id} v${manifest.version}`);
  }
}

export function unloadAllModules(): void {
  for (const [, handle] of handles) handle.cleanup();
  handles.clear();
}
