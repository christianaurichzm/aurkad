import { logger } from '../logger.js';
import { getTick } from './clock.js';

// Tick-based scheduling for gameplay code. Wall-clock timers run off the
// simulation's beat and break replays, so anything that affects the sim
// is scheduled off the tick counter.

type TaskFn = () => void;

interface ScheduledTask {
  id: number;
  owner: string;
  dueTick: number;
  // 0 marks a one-shot; anything higher reschedules by that many ticks.
  intervalTicks: number;
  fn: TaskFn;
}

const tasks = new Map<number, ScheduledTask>();
let nextId = 1;

// Reused across ticks to avoid allocating in the hot path.
const dueBuffer: ScheduledTask[] = [];

function normalizeTicks(ticks: number, min: number): number {
  if (!Number.isFinite(ticks)) return min;
  return Math.max(min, Math.floor(ticks));
}

/** Runs `fn` once, `ticks` ticks from now. Returns a `cancelScheduled` id. */
export function scheduleAfter(
  ticks: number,
  fn: TaskFn,
  owner = 'engine',
): number {
  const id = nextId++;
  tasks.set(id, {
    id,
    owner,
    dueTick: getTick() + normalizeTicks(ticks, 0),
    intervalTicks: 0,
    fn,
  });
  return id;
}

/** Run `fn` every `ticks` ticks, starting `ticks` from now. */
export function scheduleEvery(
  ticks: number,
  fn: TaskFn,
  owner = 'engine',
): number {
  const id = nextId++;
  const intervalTicks = normalizeTicks(ticks, 1);
  tasks.set(id, {
    id,
    owner,
    dueTick: getTick() + intervalTicks,
    intervalTicks,
    fn,
  });
  return id;
}

export function cancelScheduled(id: number): void {
  tasks.delete(id);
}

/** Drops every task owned by `owner`. Used when a script is reloaded. */
export function cancelScheduledByOwner(owner: string): void {
  for (const task of tasks.values()) {
    if (task.owner === owner) tasks.delete(task.id);
  }
}

export function scheduledTaskCount(): number {
  return tasks.size;
}

export function resetScheduler(): void {
  tasks.clear();
  dueBuffer.length = 0;
  nextId = 1;
}

/** Tick system: runs everything due this tick. Never throws. */
export function runScheduledTasks(): void {
  const tick = getTick();

  // Collect first: a task that schedules or cancels another must not disturb
  // the iteration, and a repeating task must not run twice in one tick.
  dueBuffer.length = 0;
  for (const task of tasks.values()) {
    if (task.dueTick <= tick) dueBuffer.push(task);
  }
  if (dueBuffer.length === 0) return;

  for (const task of dueBuffer) {
    // Re-arm (or retire) before running, so a throwing repeat task still
    // advances instead of firing every tick forever.
    if (task.intervalTicks > 0) task.dueTick = tick + task.intervalTicks;
    else tasks.delete(task.id);

    try {
      task.fn();
    } catch (err) {
      logger.error(`[scheduler] task from ${task.owner} threw`, {
        tick,
        err,
      });
    }
  }
  dueBuffer.length = 0;
}
