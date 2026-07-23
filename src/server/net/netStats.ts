const WINDOW_SIZE = 100; // ticks (~5 s at 20 Hz)

interface TickRecord {
  players: number;
  bytesSent: number;
  worldUpdates: number;
  worldUpdateBytes: number;
  // Entities carried in those updates, split by how they were encoded.
  entitiesFull: number;
  entitiesPartial: number;
  entityLeaveMessages: number;
  entitiesLeft: number;
  chunksDelivered: number;
  chunkBytes: number;
}

function makeEmpty(): TickRecord {
  return {
    players: 0,
    bytesSent: 0,
    worldUpdates: 0,
    worldUpdateBytes: 0,
    entitiesFull: 0,
    entitiesPartial: 0,
    entityLeaveMessages: 0,
    entitiesLeft: 0,
    chunksDelivered: 0,
    chunkBytes: 0,
  };
}

// Circular buffer: O(1) write and evict, no array shifts.
const records: TickRecord[] = Array.from({ length: WINDOW_SIZE }, makeEmpty);
let head = 0;
let filled = 0;
let acc: TickRecord = makeEmpty();

export function nsCountPlayer(): void {
  acc.players++;
}

export function nsCountBytes(n: number): void {
  acc.bytesSent += n;
}

// One per-tick worldUpdate sent to one viewer, plus how many entities in it
// were encoded in full (entering the viewport) vs as changed fields only.
export function nsCountWorldUpdate(
  bytes: number,
  entitiesFull: number,
  entitiesPartial: number,
): void {
  acc.worldUpdates++;
  acc.worldUpdateBytes += bytes;
  acc.entitiesFull += entitiesFull;
  acc.entitiesPartial += entitiesPartial;
}

export function nsCountEntityLeave(entityCount: number, bytes: number): void {
  acc.entityLeaveMessages++;
  acc.entitiesLeft += entityCount;
  acc.bytesSent += bytes;
}

export function nsCountChunk(bytes: number): void {
  acc.chunksDelivered++;
  acc.chunkBytes += bytes;
  acc.bytesSent += bytes;
}

export function nsFlushTick(): void {
  records[head] = { ...acc };
  head = (head + 1) % WINDOW_SIZE;
  if (filled < WINDOW_SIZE) filled++;
  acc = makeEmpty();
}

export function getNetStats(): Record<string, unknown> {
  const n = filled;
  if (n === 0) return { windowTicks: 0, note: 'no data yet' };

  let players = 0,
    bytes = 0,
    updates = 0,
    updateBytes = 0,
    entitiesFull = 0,
    entitiesPartial = 0,
    leaveMessages = 0,
    entitiesLeft = 0,
    chunks = 0,
    chunkBytes = 0;

  for (let i = 0; i < n; i++) {
    const r = records[i]!;
    players += r.players;
    bytes += r.bytesSent;
    updates += r.worldUpdates;
    updateBytes += r.worldUpdateBytes;
    entitiesFull += r.entitiesFull;
    entitiesPartial += r.entitiesPartial;
    leaveMessages += r.entityLeaveMessages;
    entitiesLeft += r.entitiesLeft;
    chunks += r.chunksDelivered;
    chunkBytes += r.chunkBytes;
  }

  const entities = entitiesFull + entitiesPartial;

  return {
    windowTicks: n,
    windowSeconds: +(n / 20).toFixed(1),
    players: {
      avgPerTick: +(players / n).toFixed(2),
    },
    bandwidth: {
      avgBytesPerTick: +(bytes / n).toFixed(0),
      avgBytesPerPlayerPerTick: players > 0 ? +(bytes / players).toFixed(0) : 0,
      totalBytes: bytes,
    },
    // Key names kept stable for the /metrics endpoint. Semantics under the
    // entity-replication model: "full" = entities sent complete (entering a
    // viewport), "delta" = entities sent as changed fields only.
    dynamicSnapshots: {
      worldUpdates: updates,
      fullGameStates: entitiesFull,
      deltas: entitiesPartial,
      deltaRatioPercent:
        entities > 0 ? +((entitiesPartial / entities) * 100).toFixed(1) : 0,
      avgFullStateSizeBytes: 0,
      avgDeltaSizeBytes: updates > 0 ? +(updateBytes / updates).toFixed(0) : 0,
    },
    entityLeave: {
      totalMessages: leaveMessages,
      totalEntities: entitiesLeft,
      avgEntitiesPerMessage:
        leaveMessages > 0 ? +(entitiesLeft / leaveMessages).toFixed(1) : 0,
    },
    mapChunks: {
      totalDelivered: chunks,
      avgBytesPerChunk: chunks > 0 ? +(chunkBytes / chunks).toFixed(0) : 0,
    },
  };
}
