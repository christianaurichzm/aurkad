import { isInputActive } from '../../utils/domHelpers';
import { ICON_NAMES, type IconName } from '../../components/common/Icon';

// Action-menu buttons added by client modules (engine.ui.actionButton). The
// core ActionPanel renders one button each, so module panels open like the
// built-in ones. An optional hotkey shows as a badge and is bound here.

export interface ModuleAction {
  id: string;
  label: string;
  onClick: () => void;
  key?: string; // lowercase single char, shown as a badge and bound as a hotkey
  icon?: IconName;
}

const actions: ModuleAction[] = [];
const listeners = new Set<() => void>();
let seq = 0;

export function registerModuleAction(
  label: string,
  onClick: () => void,
  key?: string,
  icon?: string,
): void {
  actions.push({
    id: `module-action-${seq++}`,
    label,
    onClick,
    key: key?.toLowerCase(),
    // A name the stylesheet has no --icon-<name> for would paint a solid
    // square, so it gets the tile's lettered fallback instead.
    icon: ICON_NAMES.find((name) => name === icon),
  });
  ensureHotkeyListener();
  listeners.forEach((l) => l());
}

export function getModuleActions(): ModuleAction[] {
  return actions;
}

export function subscribeModuleActions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// One global keydown that toggles a module panel when its hotkey is pressed -
// ignored while typing or with modifiers held, mirroring the core panel keys.
let hotkeyListenerInstalled = false;
function ensureHotkeyListener(): void {
  if (hotkeyListenerInstalled) return;
  hotkeyListenerInstalled = true;
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.repeat || e.ctrlKey || e.altKey || e.metaKey)
      return;
    if (isInputActive()) return;
    const action = actions.find((x) => x.key && x.key === e.key.toLowerCase());
    if (!action) return;
    e.preventDefault();
    action.onClick();
  });
}
