// Coroutines for sandboxed code: a generator that pauses on `wait` /
// `waitFor` and is resumed by the tick. A cutscene or staged boss written
// with `after()` is a chain of callbacks with its state in module scope,
// which a reload leaves behind; a generator keeps the sequence in one
// function, so "walk here, wait two seconds, say this" reads in order.
//
// Resumption comes from the tick and hooks, never a wall clock, which the
// replay recorder cannot see. Each resume goes through runWithBudget, so
// coroutine time is measured like every other handler and a slow one is
// switched off. A generator that loops without yielding still stops the
// world, since the budget can only measure a resume that returns.

import { logger } from '../../logger.js';
import { on as hookOn, type HookMap } from '../hooks.js';
import { cancelScheduled, scheduleAfter } from '../../sim/scheduler.js';
import { runWithBudget } from './handlerBudget.js';
import { recordScriptError } from './scriptErrors.js';

/** What `coroutine()` returns, so a script can stop one it started. */
export interface CoroutineHandle {
  cancel: () => void;
  /** True once it ran to the end, threw, or was cancelled. */
  readonly done: boolean;
}

// A host-side marker. Scripts yield values across the vm boundary, and a plain
// shape check would accept any object with the right keys; the symbol is
// unforgeable from inside the sandbox, so a typo yields a clear error instead
// of a coroutine that waits on nothing.
const INSTRUCTION = Symbol('coroutineInstruction');

type Instruction =
  | { [INSTRUCTION]: true; kind: 'wait'; ticks: number }
  | {
      [INSTRUCTION]: true;
      kind: 'waitFor';
      event: keyof HookMap;
      predicate: ((payload: unknown) => boolean) | undefined;
    };

/** Pause for `ticks` ticks. `wait(0)` resumes on the next tick. */
export function wait(ticks: number): Instruction {
  const normalized = Number.isFinite(ticks)
    ? Math.max(0, Math.floor(ticks))
    : 0;
  return { [INSTRUCTION]: true, kind: 'wait', ticks: normalized };
}

/**
 * Pause until `event` fires, and hand its payload back as the yielded value.
 * The predicate keeps "wait for THIS npc to die" from becoming a re-yield
 * loop: a payload that does not match never wakes the generator.
 */
export function waitFor(
  event: keyof HookMap,
  predicate?: (payload: unknown) => boolean,
): Instruction {
  return { [INSTRUCTION]: true, kind: 'waitFor', event, predicate };
}

function asInstruction(value: unknown): Instruction | null {
  if (typeof value !== 'object' || value === null) return null;
  return INSTRUCTION in value ? (value as Instruction) : null;
}

/** Live coroutines, for tests and for "did the reload leave ghosts". */
const live = new Set<CoroutineHandle>();

export function activeCoroutineCount(): number {
  return live.size;
}

/** Drops every live coroutine. Test-only; a reload cancels through the handle. */
export function resetCoroutines(): void {
  for (const handle of [...live]) handle.cancel();
  live.clear();
}

const deadHandle: CoroutineHandle = { cancel: () => {}, done: true };

/**
 * Starts `fn` as a coroutine owned by `script`. It runs at once up to its
 * first yield, so a cutscene opens on the frame that triggered it, and the
 * tick resumes the rest. `onEnd` is called exactly once, however it ends,
 * and possibly before this function returns.
 */
export function startCoroutine(
  script: string,
  fn: () => Generator<unknown, unknown, unknown>,
  onEnd?: (handle: CoroutineHandle) => void,
): CoroutineHandle {
  if (typeof fn !== 'function') {
    fail(
      script,
      'coroutine',
      new Error('coroutine() needs a generator function'),
    );
    return deadHandle;
  }

  let iterator: Generator<unknown, unknown, unknown>;
  try {
    iterator = fn();
  } catch (e) {
    fail(script, 'coroutine', e);
    return deadHandle;
  }
  if (!iterator || typeof iterator.next !== 'function') {
    fail(
      script,
      'coroutine',
      new Error('coroutine() needs a generator function (use function*)'),
    );
    return deadHandle;
  }

  // Named after the generator so the budget log and the editor point at the
  // sequence that is slow, not merely at the file.
  const label = `coroutine:${fn.name || 'anonymous'}`;

  let finished = false;
  /** Undoes whatever the coroutine is currently waiting on. */
  let stopWaiting: (() => void) | null = null;

  const clearWait = () => {
    stopWaiting?.();
    stopWaiting = null;
  };

  const handle: CoroutineHandle = {
    cancel: () => {
      if (finished) return;
      finished = true;
      clearWait();
      live.delete(handle);
      onEnd?.(handle);
      // `return()` runs the generator's own finally blocks, which is how a
      // script releases what the sequence took (a frozen player, a spawned
      // npc) instead of leaking it on every reload.
      try {
        iterator.return(undefined);
      } catch (e) {
        fail(script, label, e);
      }
    },
    get done() {
      return finished;
    },
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    clearWait();
    live.delete(handle);
    onEnd?.(handle);
  };

  /**
   * One step of the generator, and the only place sandboxed code runs. The
   * predicate runs in the same budgeted entry as `next()`, or a filter on
   * every npc death would be measured as free.
   */
  const resume = (
    payload: unknown,
    predicate: ((payload: unknown) => boolean) | undefined,
  ): void => {
    if (finished) return;

    let advanced = false;
    let result: IteratorResult<unknown, unknown> | undefined;
    let ran: boolean;
    try {
      ran = runWithBudget(script, label, () => {
        if (predicate && !predicate(payload)) return;
        advanced = true;
        result = iterator.next(payload);
      });
    } catch (e) {
      // The generator threw. It cannot be resumed after that, so the coroutine
      // ends here rather than staying subscribed to a hook forever.
      finish();
      fail(script, label, e);
      return;
    }

    // Switched off by the budget, so it will never resume: end it rather than
    // leave a ghost holding a hook subscription. Ended through cancel, as it is
    // suspended at a yield and its finally blocks release what it took.
    if (!ran) {
      handle.cancel();
      return;
    }
    if (!advanced) return; // the predicate said no; keep waiting

    clearWait();
    if (result?.done) {
      finish();
      return;
    }
    arm(result?.value);
  };

  const arm = (value: unknown): void => {
    const instruction = asInstruction(value);
    if (!instruction) {
      handle.cancel();
      fail(
        script,
        label,
        new Error(
          'a coroutine yielded something that is not wait() or waitFor()',
        ),
      );
      return;
    }

    if (instruction.kind === 'wait') {
      const id = scheduleAfter(
        instruction.ticks,
        () => resume(undefined, undefined),
        script,
      );
      stopWaiting = () => cancelScheduled(id);
      return;
    }

    const unsub = hookOn(instruction.event, (payload: unknown) =>
      resume(payload, instruction.predicate),
    );
    stopWaiting = unsub;
  };

  live.add(handle);
  resume(undefined, undefined);
  return handle;
}

function fail(script: string, label: string, err: unknown): void {
  logger.error(`[script:${script}] coroutine threw`, { handler: label, err });
  recordScriptError(script, err, 'coroutine', label);
}
