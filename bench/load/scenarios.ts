// The load scenarios as data, testable without a server.
//
// Scenarios with `spread` place bots through the admin console's `tp`
// (spread.ts), so they need --admin-user/--admin-pass, and without them the
// run says it is a crowd. Placement only separates players on maps larger
// than one viewport.

export type BotBehavior = 'idle' | 'wander' | 'fight' | 'reconnect';

export interface Scenario {
  id: string;
  /** Line from the benchmark plan this implements. */
  description: string;
  bots: number;
  behavior: BotBehavior;
  /** Seconds of steady state, after everyone has connected. */
  durationSeconds: number;
  /** What the run is meant to answer. */
  watch: string;
  /** Whether bots are placed apart. L3 and L4 are crowd scenarios. */
  spread?: boolean;
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'L1',
    description: '100 players spread across several maps',
    bots: 100,
    behavior: 'wander',
    durationSeconds: 60,
    watch: 'per-map broadcast and quadtree rebuild',
    spread: true,
  },
  {
    id: 'L2',
    description: '1000 players spread out',
    bots: 1000,
    behavior: 'wander',
    durationSeconds: 120,
    watch: 'whether snapshot cost scales linearly, and memory per player',
    spread: true,
  },
  {
    id: 'L3',
    description: '500 players in one city, all in view of each other',
    bots: 500,
    behavior: 'wander',
    durationSeconds: 120,
    watch:
      'the decision on a binary protocol: only worth it if this proves CPU or bytes/tick is the wall',
  },
  {
    id: 'L4',
    description: '1000 players at one event',
    bots: 1000,
    behavior: 'wander',
    durationSeconds: 120,
    watch: 'fan-out peak and area-of-interest behaviour under a crowd',
  },
  {
    id: 'L6',
    description: 'mass login after maintenance',
    bots: 300,
    behavior: 'idle',
    durationSeconds: 20,
    watch: 'auth latency and player load, measured on the connect phase',
  },
  {
    id: 'L7',
    description: 'mass reconnect',
    bots: 200,
    behavior: 'reconnect',
    durationSeconds: 90,
    watch: 'heartbeat, re-snapshot cost and per-viewer cache reset',
  },
  {
    id: 'combat',
    description: '100 players fighting on one map',
    bots: 100,
    behavior: 'fight',
    durationSeconds: 60,
    watch: 'combat resolution and event fan-out under load',
  },
];

export function findScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id.toLowerCase() === id.toLowerCase());
}
