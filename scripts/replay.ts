import { readFileSync } from 'fs';
import type { ReplayFile } from '../src/server/sim/replayRecorder.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run replay -- <replay-file.json>');
  process.exit(1);
}

const data: ReplayFile = JSON.parse(readFileSync(file, 'utf8'));

const byPlayer = new Map<string, number>();
for (const e of data.events) {
  byPlayer.set(e.username, (byPlayer.get(e.username) ?? 0) + 1);
}

const ticks =
  data.events.length > 0
    ? data.events[data.events.length - 1]!.tick - data.events[0]!.tick + 1
    : 0;

console.log(`Replay: ${file}`);
console.log(`  version:    ${data.version}`);
console.log(`  seed:       ${data.seed}`);
console.log(`  started:    ${data.startedAt}`);
console.log(`  events:     ${data.events.length}`);
console.log(`  tick span:  ${ticks}`);
console.log(
  `  players:    ${
    [...byPlayer.entries()].map(([k, v]) => `${k} (${v} events)`).join(', ') || 'none'
  }`,
);

if (data.events.length > 0) {
  const first = data.events[0]!;
  const last = data.events[data.events.length - 1]!;
  console.log(`  tick range: ${first.tick} - ${last.tick}`);
}
