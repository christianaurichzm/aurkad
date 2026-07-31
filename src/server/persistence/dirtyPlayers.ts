const dirtyPlayerIds = new Set<string>();

export function markPlayerDirty(id: string): void {
  dirtyPlayerIds.add(id);
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
