// Time spent inside a script handler, and what happens when it is too much.
// The tick is single threaded, so a handler that loops forever stops the
// world, and the vm timeout only guards initialisation (sandbox.ts). This
// measures rather than prevents: a handler that returns slowly is caught
// and eventually stopped; one that never returns needs isolated-vm or a
// worker per script. When tick p99 climbs, the log names the handler.

import { config } from '../../config.js';
import { logger } from '../../logger.js';
import { recordScriptError } from './scriptErrors.js';

interface Budget {
  /** Breaches so far, reset when the script reloads. */
  strikes: number;
  /** Slowest single run, for the message that finally disables it. */
  worstMs: number;
  disabled: boolean;
}

const budgets = new Map<string, Budget>();

const keyOf = (script: string, label: string): string => `${script}|${label}`;

function budgetFor(script: string, label: string): Budget {
  const key = keyOf(script, label);
  let budget = budgets.get(key);
  if (!budget) {
    budget = { strikes: 0, worstMs: 0, disabled: false };
    budgets.set(key, budget);
  }
  return budget;
}

/**
 * Runs a script handler, timing it and dropping it if it keeps overrunning.
 *
 * Returns whether the handler ran, so a caller that reports "did anything
 * happen" keeps telling the truth after a handler is disabled.
 *
 * Errors are NOT caught here: every call site already isolates and attributes
 * them, and catching twice would swallow the attribution.
 */
export function runWithBudget(
  script: string,
  label: string,
  fn: () => void,
): boolean {
  const budget = budgetFor(script, label);
  if (budget.disabled) return false;

  const startedAt = performance.now();
  try {
    fn();
  } finally {
    const elapsed = performance.now() - startedAt;
    if (elapsed > config.scripting.handlerBudgetMs) {
      budget.strikes++;
      budget.worstMs = Math.max(budget.worstMs, elapsed);
      report(script, label, budget, elapsed);
    }
  }
  return true;
}

function report(
  script: string,
  label: string,
  budget: Budget,
  elapsed: number,
): void {
  const limit = config.scripting.handlerBudgetMs;
  const strikes = config.scripting.handlerBudgetStrikes;

  if (budget.strikes < strikes) {
    // One line per breach up to the limit: a handler that is occasionally slow
    // is worth knowing about, and silence until the moment it is disabled
    // would make that look sudden.
    logger.warn('[budget] script handler over its time budget', {
      script,
      handler: label,
      ms: Math.round(elapsed),
      limitMs: limit,
      strike: budget.strikes,
      of: strikes,
    });
    return;
  }

  budget.disabled = true;
  const message =
    `disabled after ${budget.strikes} runs over ${limit}ms ` +
    `(worst ${Math.round(budget.worstMs)}ms). Fix it and save to re-enable.`;
  logger.error(`[budget] ${script}.${label} ${message}`);
  // Also recorded as a script error so it shows up in the editor next to the
  // file, where whoever wrote it is looking.
  recordScriptError(
    script,
    { name: 'HandlerBudget', message },
    'budget',
    label,
  );
}

/** Whether a handler is currently switched off. Editor and test use. */
export function isHandlerDisabled(script: string, label: string): boolean {
  return budgets.get(keyOf(script, label))?.disabled ?? false;
}

/**
 * Forgets everything recorded for a script. Called when it reloads: the file
 * on disk is new code, so it deserves its budget back.
 */
export function clearHandlerBudget(script?: string): void {
  if (!script) {
    budgets.clear();
    return;
  }
  for (const key of budgets.keys()) {
    if (key.startsWith(`${script}|`)) budgets.delete(key);
  }
}

/** Handlers switched off now, newest first, for the editor and metrics. */
export function disabledHandlers(): Array<{ script: string; handler: string }> {
  const out: Array<{ script: string; handler: string }> = [];
  for (const [key, budget] of budgets) {
    if (!budget.disabled) continue;
    const [script, handler] = key.split('|');
    out.push({ script: script ?? '', handler: handler ?? '' });
  }
  return out;
}
