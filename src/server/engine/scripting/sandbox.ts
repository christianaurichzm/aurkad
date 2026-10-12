import vm from 'node:vm';
import { logger } from '../../logger.js';
import { buildApi } from './api.js';
import { getContentConstants } from './contentConstants.js';
import { recordScriptError } from './scriptErrors.js';
import { clearHandlerBudget } from './handlerBudget.js';

// TRUST MODEL: read before exposing this to untrusted code.
//
// This is trusted scripting, NOT a security sandbox. Bare Node globals
// (process, require, Buffer) are not bound, but the API passes real host
// objects (player, npc, map) in, and any of them is an easy escape:
//
//   player.constructor.constructor('return process')()
//
// returns the host realm's `process`, a known limit of node:vm with shared
// objects. So only run scripts written by the server owner. Strangers
// uploading scripts to shared infrastructure need isolated-vm or a worker
// per tenant. The timeout below only guards init-time infinite loops, not
// hook handlers at runtime.

type Cleanup = () => void;
type TimerId = ReturnType<typeof setInterval>;

export interface ScriptHandle {
  cleanup: () => void;
  /**
   * Whether the top-level evaluation finished. A script that threw on the way
   * up registered only what came before the throw, and the module loader,
   * resolving dependents, has to tell that from a script that ran.
   */
  ok: boolean;
}

const INIT_TIMEOUT_MS = 5_000;

export function runInSandbox(
  code: string,
  filename: string,
  extraGlobals: Record<string, unknown> = {},
): ScriptHandle {
  const unsubs: Cleanup[] = [];
  const timers: Set<TimerId> = new Set();

  const trackUnsub = (fn: Cleanup) => unsubs.push(fn);
  const trackTimer = (id: TimerId) => timers.add(id);

  const api = buildApi(filename, trackUnsub, trackTimer);

  // The VM context gets only our API plus extra globals (e.g. a module's
  // `config`). ECMAScript intrinsics (Math, JSON, Array, ...) come from the
  // new V8 context, isolated.
  const ctx = vm.createContext({
    ...api,
    // Typed content constants (Items, Npcs, Maps, Spells, Arrows) built from
    // the current game content, so scripts reference names instead of raw ids.
    ...getContentConstants(),
    ...extraGlobals,
    console: { log: api.log, warn: api.warn, error: api.error },
  });

  // `Math.random` would leave the seeded sequence unseen by the recorder, so
  // replay would drift. It points at the engine's own generator, so the
  // reflex authors bring is correct here; patched inside the context, so
  // scripts keep their realm's Math rather than a host object.
  vm.runInContext('Math.random = random;', ctx);

  // The time budget goes with the code it measured, so whatever loads under
  // this name next, a script saved again or a module reloaded, starts with
  // its handlers switched on.
  const cleanup = (): void => {
    unsubs.forEach((fn) => fn());
    timers.forEach((id) => clearInterval(id));
    timers.clear();
    clearHandlerBudget(filename);
  };

  try {
    const script = new vm.Script(code, { filename });
    script.runInContext(ctx, { timeout: INIT_TIMEOUT_MS });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
      msg.includes('timed out') ||
      msg.includes('Script execution timed out')
    ) {
      logger.error(
        `[scripting] Init timed out after ${INIT_TIMEOUT_MS}ms: ${filename}`,
      );
    } else {
      logger.error(`[scripting] Runtime error in ${filename}`, { err: e });
    }
    recordScriptError(filename, e, 'load');
    cleanup();
    return { cleanup: () => {}, ok: false };
  }

  return { cleanup, ok: true };
}
