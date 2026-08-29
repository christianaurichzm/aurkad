/**
 * How long the client's frames take, shaped like the server's tick metrics
 * (`server/metrics.ts`). Only on when the page has `?frameprof` in its URL.
 */

// Ten seconds of frames at 60 fps, like the server's window, enough for a
// p99 that is not just the maximum.
const WINDOW = 600;

const frameMs = new Float64Array(WINDOW);
const renderMs = new Float64Array(WINDOW);
let head = 0;
let filled = 0;

export const frameProfileEnabled =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has('frameprof');

/**
 * One frame: the gap since the previous one, which is what fps means, and
 * the render inside it, which is our share.
 */
export function recordFrame(gapMs: number, drawMs: number): void {
  frameMs[head] = gapMs;
  renderMs[head] = drawMs;
  head = (head + 1) % WINDOW;
  if (filled < WINDOW) filled++;
  // One line per full window, so numbers appear while the problem happens.
  if (filled === WINDOW && head === 0) {
    const { frame, render } = getFrameStats();
    console.info(
      `[frameprof] frame p50 ${frame.p50Ms} p95 ${frame.p95Ms} p99 ${frame.p99Ms} max ${frame.maxMs} ms | ` +
        `render p50 ${render.p50Ms} p95 ${render.p95Ms} p99 ${render.p99Ms} max ${render.maxMs} ms`,
    );
  }
}

// Nearest-rank, the same definition the server's percentiles use, so a number
// from here can be compared with one from /metrics without a footnote.
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function summarize(series: Float64Array) {
  const values: number[] = [];
  let sum = 0;
  for (let i = 0; i < filled; i++) {
    const v = series[i];
    values.push(v);
    sum += v;
  }
  values.sort((a, b) => a - b);
  return {
    avgMs: filled === 0 ? 0 : round2(sum / filled),
    p50Ms: round2(percentile(values, 50)),
    p95Ms: round2(percentile(values, 95)),
    p99Ms: round2(percentile(values, 99)),
    maxMs: round2(values[values.length - 1] ?? 0),
  };
}

export function getFrameStats() {
  return {
    samples: filled,
    frame: summarize(frameMs),
    render: summarize(renderMs),
  };
}

export function resetFrameStats(): void {
  head = 0;
  filled = 0;
}

// Reachable from the console as `frameStats()` while the flag is on.
if (frameProfileEnabled) {
  (window as unknown as { frameStats: typeof getFrameStats }).frameStats =
    getFrameStats;
  console.info('[frameprof] on: call frameStats() for the current window');
}
