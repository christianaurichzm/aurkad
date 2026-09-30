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

// Slots along the bottom of the world (engine.ui.hotbar), drawn by the core
// Hotbar, since icons come off the spell sheet only the engine holds. Each
// module replaces its own run of slots; the bar keeps module load order.

export interface HotbarSlot {
  id: string;
  name: string;
  description?: string;
  /** The KeyboardEvent.key that uses it (F1), shown on the slot and bound. */
  key?: string;
  /** A tile of the spell sheet; without one the slot shows the name's initial. */
  icon?: number;
  /** Mana, shown on the slot. */
  cost?: number;
  /** Date.now() at which the cooldown ends. */
  readyAt?: number;
  /** The whole cooldown, so the slot can show the share of it left. */
  cooldownMs?: number;
  noMana?: boolean;
  /** Aimed at the player's side (a heal) rather than at enemies. */
  friendly?: boolean;
  onUse: () => void;
}

const hotbars = new Map<string, HotbarSlot[]>();
let hotbarSlots: HotbarSlot[] = [];
const hotbarListeners = new Set<() => void>();

export function setHotbar(moduleId: string, slots: HotbarSlot[]): void {
  hotbars.set(moduleId, slots);
  // A new array each time: useSyncExternalStore compares snapshots by identity.
  hotbarSlots = [...hotbars.values()].flat();
  ensureHotkeyListener();
  hotbarListeners.forEach((l) => l());
}

export function getHotbarSlots(): HotbarSlot[] {
  return hotbarSlots;
}

export function subscribeHotbar(listener: () => void): () => void {
  hotbarListeners.add(listener);
  return () => hotbarListeners.delete(listener);
}

// One global keydown for module panel hotkeys and hotbar keys, ignored while
// typing or with modifiers, like the core panel keys. Only bound keys are
// taken from the browser, so F1 with no spell still opens its help.
let hotkeyListenerInstalled = false;
function ensureHotkeyListener(): void {
  if (hotkeyListenerInstalled) return;
  hotkeyListenerInstalled = true;
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.repeat || e.ctrlKey || e.altKey || e.metaKey)
      return;
    if (isInputActive()) return;
    const key = e.key.toLowerCase();
    const use =
      actions.find((x) => x.key === key)?.onClick ??
      hotbarSlots.find((x) => x.key?.toLowerCase() === key)?.onUse;
    if (!use) return;
    e.preventDefault();
    use();
  });
}
