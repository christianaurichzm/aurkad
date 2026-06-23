const WINDOW_SIZE = 100; // ticks (~5 s at 20 Hz)

interface TickRecord {
  players: number;
  bytesSent: number;
  fullGameStates: number;
  fullGameStateBytes: number;
  deltas: number;
  deltaBytes: number;
  entityLeaveMessages: number;
  entitiesLeft: number;
  chunksDelivered: number;
  chunkBytes: number;
}

function makeEmpty(): TickRecord {
  return {
    players: 0,
    bytesSent: 0,
    fullGameStates: 0,
    fullGameStateBytes: 0,
    deltas: 0,
    deltaBytes: 0,
    entityLeaveMessages: 0,
    entitiesLeft: 0,
    chunksDelivered: 0,
    chunkBytes: 0,
  };
}

const records: TickRecord[] = [];
let acc: TickRecord = makeEmpty();

export function nsCountPlayer(): void {
  acc.players++;
}

export function nsCountBytes(n: number): void {
  acc.bytesSent += n;
}

export function nsCountFullState(bytes: number): void {
  acc.fullGameStates++;
  acc.fullGameStateBytes += bytes;
}

export function nsCountDelta(bytes: number): void {
  acc.deltas++;
  acc.deltaBytes += bytes;
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
  records.push({ ...acc });
  if (records.length > WINDOW_SIZE) records.shift();
  acc = makeEmpty();
}

export function getNetStats(): Record<string, unknown> {
  const n = records.length;
  if (n === 0) return { windowTicks: 0, note: 'no data yet' };

  let players = 0,
    bytes = 0,
    fullStates = 0,
    fullBytes = 0,
    deltas = 0,
    deltaBytes = 0,
    leaveMessages = 0,
    entitiesLeft = 0,
    chunks = 0,
    chunkBytes = 0;

  for (const r of records) {
    players += r.players;
    bytes += r.bytesSent;
    fullStates += r.fullGameStates;
    fullBytes += r.fullGameStateBytes;
    deltas += r.deltas;
    deltaBytes += r.deltaBytes;
    leaveMessages += r.entityLeaveMessages;
    entitiesLeft += r.entitiesLeft;
    chunks += r.chunksDelivered;
    chunkBytes += r.chunkBytes;
  }

  const messages = fullStates + deltas;

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
    dynamicSnapshots: {
      fullGameStates: fullStates,
      deltas,
      deltaRatioPercent:
        messages > 0 ? +((deltas / messages) * 100).toFixed(1) : 0,
      avgFullStateSizeBytes:
        fullStates > 0 ? +(fullBytes / fullStates).toFixed(0) : 0,
      avgDeltaSizeBytes: deltas > 0 ? +(deltaBytes / deltas).toFixed(0) : 0,
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
