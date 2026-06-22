// Registry of action-menu buttons contributed by client modules (engine.ui
// .actionButton). The core ActionPanel subscribes and renders one button each,
// so module panels open like the built-in ones instead of being always on.

export interface ModuleAction {
  id: string;
  label: string;
  onClick: () => void;
}

const actions: ModuleAction[] = [];
const listeners = new Set<() => void>();
let seq = 0;

export function registerModuleAction(label: string, onClick: () => void): void {
  actions.push({ id: `module-action-${seq++}`, label, onClick });
  listeners.forEach((l) => l());
}

export function getModuleActions(): ModuleAction[] {
  return actions;
}

export function subscribeModuleActions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
