export function getEl<T extends HTMLElement = HTMLElement>(
  id: string,
): T | null {
  return document.getElementById(id) as T | null;
}

export function setInputValue(id: string, value: any) {
  const el = getEl<HTMLInputElement | HTMLSelectElement>(id);
  if (el) el.value = String(value);
}

export function getInputValue(id: string): string {
  const el = getEl<HTMLInputElement | HTMLSelectElement>(id);
  return el ? el.value : '';
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

export function setText(id: string, text: string) {
  const el = getEl(id);
  if (el) el.textContent = text;
}

export function addEvent<T extends HTMLElement>(
  id: string,
  event: keyof HTMLElementEventMap,
  handler: (e: any) => any,
) {
  const el = getEl<T>(id);
  if (el) el.addEventListener(event, handler);
}

export const removeEvent = (
  id: string,
  evt: keyof HTMLElementEventMap,
  fn: any,
) => {
  const el = getEl(id);
  if (el) el.removeEventListener(evt, fn);
};

export function safeParseInt(value: any, fallback = 0): number {
  const n = parseInt(value, 10);
  return isNaN(n) ? fallback : n;
}
export function safeParseFloat(value: any, fallback = 0): number {
  const n = parseFloat(value);
  return isNaN(n) ? fallback : n;
}

export function clearChildren(id: string) {
  const el = getEl(id);
  if (el) el.innerHTML = '';
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

export function batchSetInputs(obj: Record<string, string | number>) {
  Object.entries(obj).forEach(([id, value]) => setInputValue(id, value));
}
