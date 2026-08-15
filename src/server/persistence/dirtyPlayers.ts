const dirtyPlayerIds = new Set<string>();

/**
 * Ids inside an economic commit that is still in flight. The write-behind
 * loop writes each dirty player alone, so a sweep during a trade could
 * write one of the pair and a crash would tear the trade. These stay dirty
 * for the next sweep, by when the commit has written both or neither.
 */
const committingPlayerIds = new Set<string>();

export function markPlayerDirty(id: string): void {
  dirtyPlayerIds.add(id);
}

export function beginPlayerCommit(ids: string[]): void {
  for (const id of ids) committingPlayerIds.add(id);
}

export function endPlayerCommit(ids: string[]): void {
  for (const id of ids) committingPlayerIds.delete(id);
}

export function isPlayerCommitting(id: string): boolean {
  return committingPlayerIds.has(id);
}

export function clearPlayerDirty(id: string): void {
  dirtyPlayerIds.delete(id);
}

/**
 * Players waiting to be written, published as a metric. A number that climbs
 * instead of returning to zero every flush means the write-behind loop is not
 * keeping up, which looks like nothing until a crash loses the difference.
 */
export function dirtyPlayerCount(): number {
  return dirtyPlayerIds.size;
}

export function drainDirtyPlayerIds(): string[] {
  const ids = [...dirtyPlayerIds];
  dirtyPlayerIds.clear();
  return ids;
}
