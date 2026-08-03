// Time spent inside a script handler, and what happens when it is too much.
// The tick is single threaded, so a handler that loops forever stops the
// world, and the vm timeout only guards initialisation (sandbox.ts). This
// measures rather than prevents: a handler that returns slowly is caught
// and eventually stopped; one that never returns needs isolated-vm or a
// worker per script. When tick p99 climbs, the log names the handler.
//
// The strike counter only sees peaks. A handler at 7.9ms of every 50ms
// frame never strikes and owns a sixth of the server, so every run is also
// summed, published per handler and compared with wall time per script.

import { config } from '../../config.js';
import { logger } from '../../logger.js';
import { recordScriptError } from './scriptErrors.js';

interface Budget {
  /** Which file and which handler, so nothing has to parse the map key back. */
  script: string;
  handler: string;
  /** Breaches so far, reset when the script reloads. */
  strikes: number;
  /** Slowest single run, for the message that finally disables it. */
  worstMs: number;
  disabled: boolean;
  /** Since the script loaded, for the scrape. */
  totalMs: number;
  calls: number;
  /** Inside the window being measured right now. */
  windowMs: number;
}

const budgets = new Map<string, Budget>();

/**
 * Share of wall time each script took in the last COMPLETE window.
 *
 * The window in progress is not published: scraped halfway
 * through, a script would read as costing half of what it does.
 */
const lastShare = new Map<string, number>();
let windowStartedAt = performance.now();

const keyOf = (script: string, label: string): string => `${script}|${label}`;

function budgetFor(script: string, handler: string): Budget {
  const key = keyOf(script, handler);
  let budget = budgets.get(key);
  if (!budget) {
    budget = {
      script,
      handler,
      strikes: 0,
      worstMs: 0,
      disabled: false,
      totalMs: 0,
      calls: 0,
      windowMs: 0,
    };
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
    const finishedAt = performance.now();
    const elapsed = finishedAt - startedAt;

    budget.totalMs += elapsed;
    budget.calls++;
    budget.windowMs += elapsed;

    if (elapsed > config.scripting.handlerBudgetMs) {
      budget.strikes++;
      budget.worstMs = Math.max(budget.worstMs, elapsed);
      report(script, label, budget, elapsed);
    }

    // Closed from here rather than from a timer: this is the one place that
    // runs whenever sandboxed code does, and a window nobody is filling has
    // nothing to report.
    closeWindowIfDue(finishedAt);
  }
  return true;
}

/**
 * Ends the measurement window, if it is over, and says who spent it.
 *
 * Per script rather than per handler: an operator reading the line has a file
 * to open, and what a file costs is all of its handlers added up. The worst
 * handler inside it rides along, because that is where to look first.
 */
function closeWindowIfDue(now: number): void {
  const windowMs = now - windowStartedAt;
  if (windowMs < config.scripting.handlerTimeWindowMs) return;

  const perScript = new Map<string, { ms: number; worst: Budget | null }>();
  for (const budget of budgets.values()) {
    const entry = perScript.get(budget.script) ?? { ms: 0, worst: null };
    entry.ms += budget.windowMs;
    if (!entry.worst || budget.windowMs > entry.worst.windowMs) {
      entry.worst = budget;
    }
    perScript.set(budget.script, entry);
  }

  lastShare.clear();
  for (const [script, entry] of perScript) {
    const percent = (entry.ms / windowMs) * 100;
    lastShare.set(script, percent);

    if (percent >= config.scripting.handlerShareWarnPercent) {
      logger.warn('[budget] script is taking a large share of the server', {
        script,
        percentOfWallClock: Math.round(percent * 10) / 10,
        msInWindow: Math.round(entry.ms),
        windowMs: Math.round(windowMs),
        worstHandler: entry.worst?.handler,
      });
    }
  }

  for (const budget of budgets.values()) budget.windowMs = 0;
  windowStartedAt = now;
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
    lastShare.clear();
    windowStartedAt = performance.now();
    return;
  }
  for (const [key, budget] of budgets) {
    if (budget.script === script) budgets.delete(key);
  }
  lastShare.delete(script);
}

/** Handlers switched off now, newest first, for the editor and metrics. */
export function disabledHandlers(): Array<{ script: string; handler: string }> {
  const out: Array<{ script: string; handler: string }> = [];
  for (const budget of budgets.values()) {
    if (!budget.disabled) continue;
    out.push({ script: budget.script, handler: budget.handler });
  }
  return out;
}

/**
 * What every handler has cost since its script loaded, as totals so a missed
 * scrape loses nothing. `calls` tells a script that is slow once from one
 * that is cheap ten thousand times.
 */
export function handlerCosts(): Array<{
  script: string;
  handler: string;
  totalMs: number;
  calls: number;
}> {
  return [...budgets.values()]
    .map(({ script, handler, totalMs, calls }) => ({
      script,
      handler,
      totalMs: Math.round(totalMs * 1000) / 1000,
      calls,
    }))
    .sort((a, b) => b.totalMs - a.totalMs);
}

/** Share of wall time per script over the last complete window, worst first. */
export function scriptTimeShares(): Array<{ script: string; percent: number }> {
  return [...lastShare]
    .map(([script, percent]) => ({
      script,
      percent: Math.round(percent * 100) / 100,
    }))
    .sort((a, b) => b.percent - a.percent);
}
