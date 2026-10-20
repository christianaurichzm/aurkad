import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { gamePath } from '../../config.js';
import { logger } from '../../logger.js';
import { runInSandbox, type ScriptHandle } from './sandbox.js';
import {
  clearScriptErrors,
  recordScriptDiagnostic,
  recordScriptError,
} from './scriptErrors.js';

// The game's scripts, with the content.generated.d.ts written at boot next to
// them. global.d.ts and the tsconfig describe the engine's API, not a game, so
// they stay in the engine's scripts/ when the game has a folder of its own
// (GAME_DIR); without one the two are the same folder.
export const SCRIPTS_DIR = gamePath('scripts');
export const SCRIPT_API_DIR = path.resolve('scripts');
const handles = new Map<string, ScriptHandle>();
let watcher: fs.FSWatcher | null = null;

let ts: typeof import('typescript') | null = null;

export function initTsSupport(): void {
  try {
    // Required, not imported: the package is one 9 MB CommonJS file, and an
    // ESM import scans all of it for its format and named exports, which is
    // most of the load cost for a module read only for its default export.
    ts = createRequire(import.meta.url)(
      'typescript',
    ) as typeof import('typescript');
    logger.info(
      '[scripting] TypeScript available - .ts scripts, type checking',
    );
  } catch {
    logger.info(
      '[scripting] TypeScript package not found - .ts scripts and the type check are off',
    );
  }
}

/**
 * TypeScript or JSX down to the plain script a sandbox or the browser runs.
 * JSX becomes `React.createElement` calls: a module's browser half may be
 * `.jsx`, and the client loader hands it `React`. Syntax errors come back as
 * `file(line,col): message`, since what TypeScript emits past one still runs.
 */
export function transpile(
  raw: string,
  fileName: string,
): { code: string; errors: string[] } | null {
  if (!ts) return null;
  const tsc = ts;
  const out = tsc.transpileModule(raw, {
    compilerOptions: {
      module: tsc.ModuleKind.ESNext,
      target: tsc.ScriptTarget.ES2022,
      strict: false,
      jsx: tsc.JsxEmit.React,
    },
    fileName,
    reportDiagnostics: true,
  });
  const errors = (out.diagnostics ?? []).map((d) => {
    const message = tsc.flattenDiagnosticMessageText(d.messageText, ' ');
    if (!d.file || d.start === undefined) return `${fileName}: ${message}`;
    const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
    return `${fileName}(${line + 1},${character + 1}): ${message}`;
  });
  return { code: out.outputText, errors };
}

function prepareCode(filePath: string): string | null {
  const raw = fs.readFileSync(filePath, 'utf-8');
  if (filePath.endsWith('.ts')) {
    const out = transpile(raw, path.basename(filePath));
    if (!out) {
      logger.warn(
        `[scripting] Skipping ${path.basename(filePath)}: TypeScript not available`,
      );
      return null;
    }
    return out.code;
  }
  return raw;
}

/**
 * Type errors in the loaded scripts, put where their author will see them.
 * Uncompiled, `giveItm(...)` is fine JavaScript until its branch runs in
 * front of players; tsc reads the same `global.d.ts` the editor uses.
 *
 * Reported, never blocking: checkJs also flags code that works, and a game
 * that ran yesterday has to boot today. `vm.Script` already refuses syntax.
 * One program per file, since each script has its own context and may
 * repeat a top-level `const`; the programs are chained so the lib and the
 * declarations are parsed once.
 *
 * Load only, not hot reload: ~200 ms for the first file and ~60 ms per file
 * after, on the tick's thread. The browser editor shows the same as you type.
 */
export function checkScriptTypes(files: string[]): void {
  const tsc = ts;
  if (!tsc || files.length === 0) return;

  const config = tsc.readConfigFile(
    path.join(SCRIPT_API_DIR, 'tsconfig.json'),
    (f) => tsc.sys.readFile(f),
  );
  // Read rather than restated so this and `npm run typecheck:scripts` cannot
  // drift, with the three the check is meaningless without forced on in case
  // the file is not there at all.
  const { options } = tsc.parseJsonConfigFileContent(
    config.config ?? {},
    tsc.sys,
    SCRIPT_API_DIR,
  );
  const compilerOptions = {
    ...options,
    allowJs: true,
    checkJs: true,
    noEmit: true,
  };

  const declarations = [
    path.join(SCRIPT_API_DIR, 'global.d.ts'),
    path.join(SCRIPTS_DIR, 'content.generated.d.ts'),
  ].filter((f) => fs.existsSync(f));

  let program: import('typescript').Program | undefined;
  for (const file of files) {
    program = tsc.createProgram(
      [...declarations, file],
      compilerOptions,
      undefined,
      program,
    );
    const source = program.getSourceFile(file);
    if (!source) continue;

    const name = path.basename(file);
    for (const d of tsc.getPreEmitDiagnostics(program, source)) {
      if (d.file !== source || d.start === undefined) continue;
      const { line, character } = tsc.getLineAndCharacterOfPosition(
        source,
        d.start,
      );
      const message = tsc.flattenDiagnosticMessageText(d.messageText, ' ');
      recordScriptDiagnostic(name, message, line + 1, character + 1);
      logger.warn(`[scripting] ${name}:${line + 1} ${message}`);
    }
  }
}

function loadFile(filePath: string): void {
  const name = path.basename(filePath);
  handles.get(name)?.cleanup();
  handles.delete(name);
  // The file is about to be re-evaluated, so whatever the previous version
  // reported no longer describes the code on disk. Clearing here is what makes
  // the editor's markers disappear once a fix is saved.
  clearScriptErrors(name);

  let code: string | null;
  try {
    code = prepareCode(filePath);
  } catch (e) {
    logger.error(`[scripting] Failed to read ${name}`, { err: e });
    recordScriptError(name, e, 'load');
    return;
  }
  if (code === null) return;

  const handle = runInSandbox(code, name);
  handles.set(name, handle);
}

function unloadFile(name: string): void {
  handles.get(name)?.cleanup();
  handles.delete(name);
  clearScriptErrors(name);
  logger.info(`[scripting] Unloaded: ${name}`);
}

const SCRIPT_EXT = ['.js', '.ts'];
export const isScriptFile = (f: string) =>
  !f.endsWith('.d.ts') && SCRIPT_EXT.some((ext) => f.endsWith(ext));

export function loadScripts(): void {
  initTsSupport();

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
    // After the loads: each one clears what the previous version reported.
    checkScriptTypes(files.map((f) => path.join(SCRIPTS_DIR, f)));
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
