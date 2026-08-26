// Recent script failures, kept so the editor can point at the line that
// broke. Hooks, timers and tasks isolate a throwing handler so one bad
// script cannot take the loop down, which leaves only a server log line,
// unseen by whoever edits the file in the browser. The logger still gets
// every occurrence; this is a small deduplicated view for the editor.

export type ScriptErrorSource =
  'load' | 'hook' | 'schedule' | 'timer' | 'behavior' | 'coroutine' | 'budget';

export interface ScriptError {
  script: string;
  message: string;
  /** 1-based, when the stack pointed inside the script. */
  line?: number;
  column?: number;
  source: ScriptErrorSource;
  /** Hook event or task description, whichever applies. */
  context?: string;
  stack?: string;
  /** Epoch ms of the most recent occurrence. */
  at: number;
  /** Repeats collapsed into this entry. */
  count: number;
}

// A handler that throws on the `tick` hook fails 20 times a second, so entries
// are keyed by where and what rather than appended blindly.
const errors = new Map<string, ScriptError>();

// Enough to cover "which of my scripts are broken" without letting a runaway
// script hold unbounded memory.
const MAX_ENTRIES = 50;

/**
 * Pulls the first stack frame that belongs to `script`.
 *
 * Frames from engine code are skipped: the interesting line is the one the
 * script author can actually edit, which is never the top frame when the throw
 * happened inside a helper the API handed them.
 */
export function locateInScript(
  stack: string | undefined,
  script: string,
): { line: number; column?: number } | undefined {
  if (!stack) return undefined;

  for (const raw of stack.split('\n')) {
    const line = raw.trim();

    // `    at fn (example.js:3:9)` / `    at example.js:3:9`
    const frame = /^at\s+(?:.*?\s+\()?(.+?):(\d+):(\d+)\)?$/.exec(line);
    if (frame && isSameFile(frame[1]!, script)) {
      return { line: Number(frame[2]), column: Number(frame[3]) };
    }

    // A SyntaxError from vm.Script leads with `example.js:3` and has no frames
    // at all, so the position is only available from that header.
    const header = /^(.+?):(\d+)$/.exec(line);
    if (header && isSameFile(header[1]!, script)) {
      return { line: Number(header[2]) };
    }
  }
  return undefined;
}

function isSameFile(candidate: string, script: string): boolean {
  return candidate === script || candidate.endsWith(`/${script}`);
}

/**
 * Reads an error's shape without `instanceof`. A script's Error comes from
 * its own realm, so `instanceof Error` is false here even for an ordinary
 * one, and the stack this module reads would be lost.
 */
function describe(err: unknown): { message: string; stack?: string } {
  const candidate = err as
    { name?: unknown; message?: unknown; stack?: unknown } | null | undefined;

  const name = typeof candidate?.name === 'string' ? candidate.name : undefined;
  const message =
    typeof candidate?.message === 'string' ? candidate.message : undefined;
  const stack =
    typeof candidate?.stack === 'string' ? candidate.stack : undefined;

  if (message === undefined) return { message: String(err), stack };
  return { message: name ? `${name}: ${message}` : message, stack };
}

export function recordScriptError(
  script: string,
  err: unknown,
  source: ScriptErrorSource,
  context?: string,
): void {
  const { message, stack } = describe(err);
  const position = locateInScript(stack, script);

  const key = `${script}|${source}|${context ?? ''}|${message}|${position?.line ?? ''}`;
  const existing = errors.get(key);
  if (existing) {
    existing.count++;
    existing.at = Date.now();
    // Re-insert so the newest entry is last and eviction stays oldest-first.
    errors.delete(key);
    errors.set(key, existing);
    return;
  }

  if (errors.size >= MAX_ENTRIES) {
    const oldest = errors.keys().next().value;
    if (oldest !== undefined) errors.delete(oldest);
  }

  errors.set(key, {
    script,
    message,
    line: position?.line,
    column: position?.column,
    source,
    context,
    stack,
    at: Date.now(),
    count: 1,
  });
}

/** Newest first, optionally narrowed to one file. */
export function getScriptErrors(script?: string): ScriptError[] {
  const all = [...errors.values()];
  const filtered = script ? all.filter((e) => e.script === script) : all;
  return filtered.sort((a, b) => b.at - a.at);
}

/** Called on reload so a fixed script stops showing its old failures. */
export function clearScriptErrors(script?: string): void {
  if (!script) {
    errors.clear();
    return;
  }
  for (const [key, error] of errors) {
    if (error.script === script) errors.delete(key);
  }
}
