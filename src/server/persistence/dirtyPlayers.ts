const dirtyPlayerIds = new Set<string>();

/**
 * Ids inside an economic commit that is still in flight. The write-behind
 * loop writes each dirty player alone, so a sweep during a trade could
 * write one of the pair and a crash would tear the trade. These stay dirty
 * for the next sweep, by when the commit has written both or neither.
 */
const committingPlayerIds = new Map<string, number>();
const commitWaiters = new Map<string, Set<() => void>>();

export async function waitForPlayerCommit(id: string): Promise<void> {
  if (!isPlayerCommitting(id)) return;
  await new Promise<void>((resolve) => {
    const waiters = commitWaiters.get(id) ?? new Set<() => void>();
    waiters.add(resolve);
    commitWaiters.set(id, waiters);
  });
}

export function markPlayerDirty(id: string): void {
  dirtyPlayerIds.add(id);
}

export function beginPlayerCommit(ids: string[]): void {
  for (const id of ids)
    committingPlayerIds.set(id, (committingPlayerIds.get(id) ?? 0) + 1);
}

export function endPlayerCommit(ids: string[]): void {
  for (const id of ids) {
    const remaining = (committingPlayerIds.get(id) ?? 0) - 1;
    if (remaining > 0) committingPlayerIds.set(id, remaining);
    else {
      committingPlayerIds.delete(id);
      for (const resolve of commitWaiters.get(id) ?? []) resolve();
      commitWaiters.delete(id);
    }
  }
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
