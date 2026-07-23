import fs from 'fs';
import path from 'path';
import { logger } from '../../logger.js';
import { runInSandbox, type ScriptHandle } from './sandbox.js';

export const SCRIPTS_DIR = path.join(process.cwd(), 'scripts');
const handles = new Map<string, ScriptHandle>();
let watcher: fs.FSWatcher | null = null;

type TsTranspile = (code: string, filename: string) => string;
let tsTranspile: TsTranspile | null = null;

async function initTsSupport(): Promise<void> {
  try {
    const ts = (await import('typescript')).default;
    tsTranspile = (code: string, filename: string): string => {
      const result = ts.transpileModule(code, {
        compilerOptions: {
          module: ts.ModuleKind.None,
          target: ts.ScriptTarget.ES2022,
          strict: false,
        },
        fileName: filename,
      });
      return result.outputText;
    };
    logger.info('[scripting] TypeScript transpilation available');
  } catch {
    logger.info(
      '[scripting] TypeScript package not found - .ts scripts will be skipped',
    );
  }
}

function prepareCode(filePath: string): string | null {
  const raw = fs.readFileSync(filePath, 'utf-8');
  if (filePath.endsWith('.ts')) {
    if (!tsTranspile) {
      logger.warn(
        `[scripting] Skipping ${path.basename(filePath)}: TypeScript not available`,
      );
      return null;
    }
    return tsTranspile(raw, path.basename(filePath));
  }
  return raw;
}

function loadFile(filePath: string): void {
  const name = path.basename(filePath);
  handles.get(name)?.cleanup();
  handles.delete(name);

  let code: string | null;
  try {
    code = prepareCode(filePath);
  } catch (e) {
    logger.error(`[scripting] Failed to read ${name}`, { err: e });
    return;
  }
  if (code === null) return;

  const handle = runInSandbox(code, name);
  handles.set(name, handle);
}

function unloadFile(name: string): void {
  handles.get(name)?.cleanup();
  handles.delete(name);
  logger.info(`[scripting] Unloaded: ${name}`);
}

const SCRIPT_EXT = ['.js', '.ts'];
export const isScriptFile = (f: string) =>
  !f.endsWith('.d.ts') && SCRIPT_EXT.some((ext) => f.endsWith(ext));

export async function loadScripts(): Promise<void> {
  await initTsSupport();

  if (!fs.existsSync(SCRIPTS_DIR)) {
    logger.info(
      '[scripting] No scripts/ directory found - create it to add game scripts',
    );
    return;
  }

  const files = fs.readdirSync(SCRIPTS_DIR).filter(isScriptFile).sort();

  if (files.length === 0) {
    logger.info('[scripting] scripts/ directory is empty');
  } else {
    for (const file of files) {
      loadFile(path.join(SCRIPTS_DIR, file));
    }
  }

  // Hot reload: non-persistent watcher so it doesn't block process shutdown
  watcher = fs.watch(SCRIPTS_DIR, { persistent: false }, (event, filename) => {
    if (!filename || !isScriptFile(filename)) return;
    const filePath = path.join(SCRIPTS_DIR, filename);
    if (fs.existsSync(filePath)) {
      logger.info(`[scripting] Change detected - reloading: ${filename}`);
      loadFile(filePath);
    } else {
      unloadFile(filename);
    }
  });

  // Suppress ENOENT errors if scripts/ is removed while watching
  watcher.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code !== 'ENOENT')
      logger.error('[scripting] Watcher error', { err: e });
  });

  logger.info('[scripting] Watching scripts/ for changes');
}

export function unloadAllScripts(): void {
  watcher?.close();
  watcher = null;
  for (const [, handle] of handles) handle.cleanup();
  handles.clear();
}
