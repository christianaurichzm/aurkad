const dirtyPlayerIds = new Set<string>();

export function markPlayerDirty(id: string): void {
  dirtyPlayerIds.add(id);
}

export function clearPlayerDirty(id: string): void {
  dirtyPlayerIds.delete(id);
}

export function drainDirtyPlayerIds(): string[] {
  const ids = [...dirtyPlayerIds];
  dirtyPlayerIds.clear();
  return ids;
}
