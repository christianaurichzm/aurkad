/**
 * Frozen server->client wire format: the exact bytes the server sends for
 * one scripted scenario. `net/protocolGolden.test.ts` asserts the encoder
 * still produces them, and the client's `protocolDecode.test.ts` that the
 * decoder turns them back into the right world, so neither half can
 * change without the other.
 *
 * An expected diff is a wire change: bump PROTOCOL_VERSION in
 * wsProtocol.ts (stale clients reload instead of misreading), then update
 * these strings. An unexpected one is something leaking into the protocol,
 * like a field added to an entity type, which this is here to catch.
 *
 * In shared/ because both halves need it. tsconfig.server.build.json leaves
 * testFixtures/ out of the server build, as it does sim/simFixture.ts.
 */

export interface ProtocolGoldenStep {
  /** Must match the scenario step of the same name in the server test. */
  label: string;
  /** Every frame sent to the viewer during that step, in order. */
  messages: string[];
}

/**
 * Viewer is "Alice". "Bob" is another player on the map and "npc1" a goblin.
 * The map is 2x2 tiles so the chunk payload stays readable.
 */
export const PROTOCOL_GOLDEN_STEPS: ProtocolGoldenStep[] = [
  {
    // Everything a client needs on arrival: map metadata, the tiles, its own
    // cold stats, and every visible entity in full.
    label: 'first tick',
    messages: [
      '{"v":2,"type":"mapMeta","payload":{"id":"map1","name":"Test","type":"normal","cols":2,"rows":2,"revision":0}}',
      '{"v":2,"type":"mapChunk","payload":{"mapId":"map1","revision":0,"chunkX":0,"chunkY":0,"tiles":[[{"tileIndex":0},{"tileIndex":0}],[{"tileIndex":0},{"tileIndex":0}]]}}',
      '{"v":2,"type":"playerStats","payload":{"id":"alice","name":"Alice","sprite":0,"width":64,"height":64,"maxHealth":100,"attack":10,"attackRange":64,"level":1,"experience":0,"experienceToNextLevel":100,"inventory":[{"item":{"id":1,"name":"Potion","sprite":4,"type":"consumable"},"quantity":3}],"equipped":{},"access":0,"strength":0,"defense":0,"agility":0,"vitality":0,"unspentPoints":0,"speed":1,"mapId":"map1","kind":"player"}}',
      '{"v":2,"type":"worldUpdate","payload":{"entities":{"bob":{"id":"bob","name":"Bob","sprite":0,"width":64,"height":64,"maxHealth":100,"health":100,"level":1,"access":0,"position":{"x":64,"y":0},"direction":0,"action":"Idle","kind":"player"},"npc1":{"id":"npc1","name":"Goblin","sprite":0,"width":64,"height":64,"maxHealth":30,"attack":5,"attackRange":64,"behavior":"aggressive","mapId":"map1","position":{"x":64,"y":64},"direction":0,"action":"Idle","health":30,"kind":"npc"}},"leave":[],"self":{"id":"alice","position":{"x":0,"y":0},"direction":0,"action":"Idle","health":100},"droppedItems":[]}}',
    ],
  },
  {
    // Only `self` moved. No mapMeta, no chunk (already sent), no playerStats
    // (no cold field changed), and no entity fragments.
    label: 'viewer moves',
    messages: [
      '{"v":2,"type":"worldUpdate","payload":{"entities":{},"leave":[],"self":{"id":"alice","position":{"x":0,"y":64},"direction":0,"action":"Walk","health":100}}}',
    ],
  },
  {
    // Nothing at all: an idle world costs zero bytes, which catches any
    // per-tick payload creeping in.
    label: 'idle tick',
    messages: [],
  },
  {
    // A known entity sends only the fields that changed, with no full or delta
    // marker: the client merges because it already tracks the id.
    label: 'bob gains a targetPosition',
    messages: [
      '{"v":2,"type":"worldUpdate","payload":{"entities":{"bob":{"targetPosition":{"x":64,"y":64}}},"leave":[],"self":{"id":"alice","position":{"x":0,"y":64},"direction":0,"action":"Walk","health":100}}}',
    ],
  },
  {
    // A field going from set to absent MUST travel as explicit null:
    // JSON.stringify drops undefined keys, so the client would otherwise keep
    // a stale targetPosition forever. This encoding is load-bearing.
    label: 'bob clears its targetPosition',
    messages: [
      '{"v":2,"type":"worldUpdate","payload":{"entities":{"bob":{"position":{"x":64,"y":64},"targetPosition":null}},"leave":[],"self":{"id":"alice","position":{"x":0,"y":64},"direction":0,"action":"Walk","health":100}}}',
    ],
  },
  {
    // Departures are ids in `leave`, players and npcs in one flat list.
    label: 'bob and the npc leave',
    messages: [
      '{"v":2,"type":"worldUpdate","payload":{"entities":{},"leave":["bob","npc1"],"self":{"id":"alice","position":{"x":0,"y":64},"direction":0,"action":"Walk","health":100}}}',
    ],
  },
];

/** Every golden frame in order, for consumers that just replay the session. */
export const PROTOCOL_GOLDEN_MESSAGES: string[] = PROTOCOL_GOLDEN_STEPS.flatMap(
  (step) => step.messages,
);
