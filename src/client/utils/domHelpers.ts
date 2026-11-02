import { capitalizeFirst } from '../../shared/utils';

// Game input stands down while the player types and while a modal dialog waits
// for an answer. The dialog is looked up rather than found from the focus,
// which a click on its backdrop moves out of it.
export function isInputActive(): boolean {
  return (
    !!document.activeElement?.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
    ) || !!document.querySelector('[aria-modal="true"]')
  );
}

export function getEl<T extends HTMLElement = HTMLElement>(
  id: string,
): T | null {
  return document.getElementById(id) as T | null;
}

export function getInputValue(id: string): string {
  const element = document.getElementById(id) as HTMLInputElement | null;
  if (element) return element.value;

  // The map editor parks its current selection on window under this name
  // for the tile kinds that have no input of their own to read back.
  const selection = (window as unknown as Record<string, string | undefined>)[
    `selected${capitalizeFirst(id)}`
  ];
  return selection || '';
}

export function setVisibility(id: string, visible: boolean, display = 'flex') {
  const el = getEl(id);
  if (el) el.style.display = visible ? display : 'none';
}

export function show(id: string, display = 'flex') {
  setVisibility(id, true, display);
}

export function hide(id: string) {
  setVisibility(id, false);
}

export function addEvent<K extends keyof HTMLElementEventMap>(
  id: string,
  event: K,
  handler: (e: HTMLElementEventMap[K]) => void,
) {
  const el = getEl(id);
  if (el) el.addEventListener(event, handler);
}

export const removeEvent = <K extends keyof HTMLElementEventMap>(
  id: string,
  evt: K,
  fn: (e: HTMLElementEventMap[K]) => void,
) => {
  const el = getEl(id);
  if (el) el.removeEventListener(evt, fn);
};

export function safeParseInt(value: string, fallback = 0): number {
  const n = parseInt(value, 10);
  return isNaN(n) ? fallback : n;
}

export async function withLoading(id: string, fn: () => Promise<any>) {
  const btn = getEl<HTMLButtonElement>(id);
  if (btn) btn.disabled = true;
  try {
    await fn();
  } finally {
    if (btn) btn.disabled = false;
  }
}
