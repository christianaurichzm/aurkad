// Takes a CPU profile of a running server and attributes self time to
// the subsystem it was spent in.
//
//   node --inspect dist/server/server.js        # in one terminal
//   npm run loadtest -- --bots=300 ...          # in another
//   npm run profile -- --delay=30 --seconds=40  # in a third
//
// A tool rather than a one-off, so a profile is cheap to take again: a
// stale one keeps sizing work against a bottleneck that has moved.
//
// Two things the numbers depend on:
//
//   - The window is a slice of the middle of a run (`--delay`), not the
//     whole thing. Bots log in with bcrypt and leave in a heap; both ends
//     of a run are dominated by work the steady state does not do.
//   - Percentages are of BUSY CPU, not wall clock, with idle reported
//     apart. A 20 Hz loop is idle most of the time, so idle in the
//     denominator would shrink every bucket by whatever the load was and
//     make two runs incomparable.

import WebSocket from 'ws';
import { readFileSync, writeFileSync } from 'node:fs';
import { SourceMap } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';

interface CallFrame {
  functionName: string;
  scriptId: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
}

interface ProfileNode {
  id: number;
  callFrame: CallFrame;
  hitCount?: number;
  children?: number[];
  positionTicks?: Array<{ line: number; ticks: number }>;
}

interface CpuProfile {
  nodes: ProfileNode[];
  startTime: number;
  endTime: number;
  samples?: number[];
  timeDeltas?: number[];
}

const args = process.argv.slice(2);
const argOf = (name: string): string | undefined =>
  args
    .find((a) => a.startsWith(`--${name}=`))
    ?.split('=')
    .slice(1)
    .join('=');

const numArg = (name: string, fallback: number): number => {
  const raw = Number(argOf(name));
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
};

const host = argOf('host') ?? '127.0.0.1:9229';
const delaySeconds = numArg('delay', 30);
const windowSeconds = numArg('seconds', 40);
// 500 us by default. Finer sampling biases toward short frames that happen
// to be on the stack at the tick boundary.
const samplingIntervalUs = numArg('interval', 500);
const topFrames = numArg('top', 15);
const outPath = argOf('out');

/**
 * Buckets a frame by where its code lives.
 *
 * Ordered: the first match wins, so the narrow rules (npc AI inside services,
 * scripting inside engine) have to come before the broad ones.
 */
function bucketOf(frame: CallFrame): string {
  const { functionName: fn, url } = frame;

  if (fn === '(garbage collector)') return 'GC';
  if (fn === '(idle)') return '(idle)';
  // V8 attributes native code with no script behind it here. `writev` is the
  // one that matters at this scale, so it gets pulled out by name.
  if (fn === 'writev') return 'socket write (writev)';
  if (fn === '(program)') return 'unattributed (program)';

  if (url.startsWith('node:')) return 'node internals';
  if (url.includes('/node_modules/ws/')) return 'ws library';
  if (
    url.includes('/node_modules/mongoose/') ||
    url.includes('/node_modules/mongodb/')
  ) {
    return 'mongo driver';
  }
  if (url.includes('/node_modules/')) return 'other dependencies';

  // Sandboxed game code: the vm names it after the file it loaded, which lives
  // outside dist/ because scripts and modules are not compiled with the server.
  if (
    url.includes('evalmachine') ||
    /\/(modules|scripts)\//.test(url.replace(/.*\/dist\//, ''))
  ) {
    return 'scripts and modules';
  }

  if (url.includes('/server/net/')) return 'netcode';
  // Both halves of the spatial index, which live apart: the manager is
  // server-side, the Quadtree in src/shared because the client uses it too.
  // Matching only the server path would file the quadtree, one of the
  // biggest frames, under "shared".
  if (url.includes('/spatial/')) return 'AOI query (quadtree)';
  if (url.includes('/server/services/npc/')) return 'NPC AI';
  if (url.includes('/server/services/')) return 'services';
  if (url.includes('/server/sim/')) return 'sim loop';
  if (
    url.includes('/server/engine/scripting/') ||
    url.includes('/server/engine/modules/')
  ) {
    return 'scripts and modules';
  }
  if (url.includes('/server/engine/')) return 'hooks / events / commands';
  if (url.includes('/server/persistence/') || url.includes('/server/model/')) {
    return 'persistence';
  }
  if (url.includes('/server/http/') || url.includes('/server/admin/'))
    return 'http';
  if (url.includes('/shared/')) return 'shared';
  if (url.includes('/server/')) return 'server (other)';

  return url ? 'other' : 'native (other)';
}

/** Self time per node id, in microseconds. */
function selfTimes(profile: CpuProfile): Map<number, number> {
  const out = new Map<number, number>();
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];

  // timeDeltas[i] is the gap before samples[i], so it is the time charged to
  // that sample. Falling back to hitCount keeps the tool honest if a future
  // Node stops sending the arrays rather than silently reporting zeros.
  if (samples.length && samples.length === deltas.length) {
    for (let i = 0; i < samples.length; i++) {
      const id = samples[i]!;
      out.set(id, (out.get(id) ?? 0) + Math.max(0, deltas[i]!));
    }
    return out;
  }

  for (const node of profile.nodes) {
    if (node.hitCount) out.set(node.id, node.hitCount * samplingIntervalUs);
  }
  return out;
}

function shortUrl(url: string): string {
  if (!url) return 'native';
  return url
    .replace(/^file:\/\//, '')
    .replace(/^.*\/(dist|src|modules|scripts)\//, '$1/');
}

class Inspector {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.on('message', (raw) => {
      // ws types the payload as Buffer | ArrayBuffer | Buffer[], and only the
      // ArrayBuffer arm stringifies badly, which never arrives: the default
      // binaryType is nodebuffer and CDP sends text frames.
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      const msg = JSON.parse(String(raw)) as {
        id?: number;
        result?: unknown;
        error?: { message: string };
      };
      if (msg.id === undefined) return; // event, not a reply
      const waiter = this.pending.get(msg.id);
      if (!waiter) return;
      this.pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(msg.error.message));
      else waiter.resolve(msg.result);
    });
  }

  static async attach(hostPort: string): Promise<Inspector> {
    const res = await fetch(`http://${hostPort}/json/list`);
    if (!res.ok) throw new Error(`inspector list failed: ${res.status}`);
    const targets = (await res.json()) as Array<{
      webSocketDebuggerUrl?: string;
      title?: string;
    }>;
    const url = targets.find(
      (t) => t.webSocketDebuggerUrl,
    )?.webSocketDebuggerUrl;
    if (!url) throw new Error('no debuggable target on the inspector port');

    const ws = new WebSocket(url, { maxPayload: 1024 * 1024 * 1024 });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    return new Inspector(ws);
  }

  send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.ws.close();
  }
}

function report(profile: CpuProfile): void {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = selfTimes(profile);

  const buckets = new Map<string, number>();
  const frames = new Map<string, { us: number; url: string }>();
  let total = 0;

  for (const [id, us] of self) {
    const node = byId.get(id);
    if (!node) continue;
    total += us;

    const bucket = bucketOf(node.callFrame);
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + us);

    const name = node.callFrame.functionName || '(anonymous)';
    const key = `${name}@${node.callFrame.url}`;
    const entry = frames.get(key) ?? { us: 0, url: node.callFrame.url };
    entry.us += us;
    frames.set(key, entry);
  }

  const idle = buckets.get('(idle)') ?? 0;
  const busy = total - idle;
  const wall = (profile.endTime - profile.startTime) / 1e6;

  const pct = (us: number) => ((us / busy) * 100).toFixed(1).padStart(5);

  console.log(`\nwindow          ${wall.toFixed(1)} s wall`);
  console.log(`samples         ${(profile.samples ?? []).length}`);
  console.log(
    `busy CPU        ${(busy / 1e6).toFixed(1)} s of ${(total / 1e6).toFixed(1)} s ` +
      `(${((busy / total) * 100).toFixed(0)}%)`,
  );
  console.log(`sampling        ${samplingIntervalUs} us\n`);

  console.log('Self time, % of busy CPU:\n');
  const ranked = [...buckets.entries()]
    .filter(([name]) => name !== '(idle)')
    .sort((a, b) => b[1] - a[1]);
  for (const [name, us] of ranked) {
    console.log(`  ${pct(us)}%  ${name}`);
  }

  console.log(`\nTop ${topFrames} frames by self time:\n`);
  const topList = [...frames.entries()]
    .filter(([key]) => !key.startsWith('(idle)@'))
    .sort((a, b) => b[1].us - a[1].us)
    .slice(0, topFrames);
  for (const [key, entry] of topList) {
    const name = key.split('@')[0]!;
    console.log(
      `  ${pct(entry.us)}%  ${name.padEnd(28)} ${shortUrl(entry.url)}`,
    );
  }
  console.log('');
}

/**
 * Self time inside one function, line by line, mapped back to the
 * TypeScript. A bucket says which function to open, not which line in it
 * to delete: in `sendWorldUpdate`, "the AOI loop" against "the two Sets it
 * allocates per viewer" is the whole decision about what to do next.
 *
 * V8 reports this as `positionTicks` on every node, the sample count per
 * line of the emitted JS, and the dist build's source maps carry those
 * lines back to the file worth editing.
 */
function reportFrame(profile: CpuProfile, needle: string): void {
  const byLine = new Map<number, number>();
  let matched = 0;
  let url = '';

  for (const node of profile.nodes) {
    if (!node.callFrame.functionName.includes(needle)) continue;
    if (!node.positionTicks) continue;
    url = node.callFrame.url;
    for (const { line, ticks } of node.positionTicks) {
      byLine.set(line, (byLine.get(line) ?? 0) + ticks);
      matched += ticks;
    }
  }

  if (!matched) {
    console.log(`\nno samples inside a frame matching "${needle}"\n`);
    return;
  }

  const path = url.replace(/^file:\/\//, '');
  let mapper: InstanceType<typeof SourceMap> | undefined;
  let sourceLines: string[] | undefined;
  try {
    const raw = JSON.parse(
      readFileSync(`${path}.map`, 'utf8'),
    ) as ConstructorParameters<typeof SourceMap>[0];
    mapper = new SourceMap(raw);
  } catch {
    // No source map: the JS line numbers are still the answer, just less
    // pleasant to read. Better than refusing to report.
  }

  console.log(`\n${needle}: ${matched} samples of self time, by source line\n`);

  const ranked = [...byLine.entries()].sort((a, b) => b[1] - a[1]);
  for (const [line, ticks] of ranked.slice(0, 20)) {
    const share = ((ticks / matched) * 100).toFixed(1).padStart(5);
    // positionTicks lines are 1-based; findEntry wants 0-based.
    const entry = mapper?.findEntry(line - 1, 0);
    // A generated line that maps to nothing comes back as `{}`, so the field
    // being there is the whole test.
    const mapping = entry && 'originalSource' in entry ? entry : undefined;
    let where = `${shortUrl(url)}:${line}`;
    let text = '';
    if (mapping) {
      const original = mapping.originalSource.replace(/^file:\/\//, '');
      where = `${shortUrl(mapping.originalSource)}:${mapping.originalLine + 1}`;
      try {
        sourceLines ??= readFileSync(original, 'utf8').split('\n');
        text = (sourceLines[mapping.originalLine] ?? '').trim().slice(0, 72);
      } catch {
        // Source moved since the build; the location alone still locates it.
      }
    }
    console.log(`  ${share}%  ${where.padEnd(34)} ${text}`);
  }
  console.log('');
}

async function main(): Promise<void> {
  // Re-bucketing a saved profile costs nothing; re-taking one costs a
  // 300-bot run. Whenever the attribution turns out wrong, that has to be
  // fixable without paying for the measurement again.
  const from = argOf('from');
  if (from) {
    const saved = JSON.parse(readFileSync(from, 'utf8')) as CpuProfile;
    const frame = argOf('frame');
    if (frame) reportFrame(saved, frame);
    else report(saved);
    return;
  }

  console.log(`\nattaching to ${host}`);
  const inspector = await Inspector.attach(host);

  await inspector.send('Profiler.enable');
  await inspector.send('Profiler.setSamplingInterval', {
    interval: samplingIntervalUs,
  });

  if (delaySeconds > 0) {
    console.log(`waiting ${delaySeconds}s for the run to reach steady state`);
    await sleep(delaySeconds * 1000);
  }

  console.log(`profiling for ${windowSeconds}s`);
  await inspector.send('Profiler.start');
  await sleep(windowSeconds * 1000);
  const { profile } = await inspector.send<{ profile: CpuProfile }>(
    'Profiler.stop',
  );

  inspector.close();

  if (outPath) {
    writeFileSync(outPath, JSON.stringify(profile));
    console.log(`raw profile written to ${outPath}`);
  }

  const frame = argOf('frame');
  if (frame) reportFrame(profile, frame);
  else report(profile);
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
