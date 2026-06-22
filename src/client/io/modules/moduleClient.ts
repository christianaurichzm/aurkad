import { onServerEvent, sendServerEvent } from '../network/customEvents';
import { colors, radius, shadow, zIndex } from '../../theme';
import { registerModuleAction } from './moduleActions';

// Loads the module browser entries the server serves and runs them with an
// `engine` API. Like server scripts, this is the server owner's code, so it
// runs with no sandbox.

interface ClientModule {
  id: string;
  client: string;
}

function moduleContainer(id: string): HTMLElement {
  let host = document.getElementById('module-ui');
  if (!host) {
    host = document.createElement('div');
    host.id = 'module-ui';
    document.body.appendChild(host);
  }
  const elId = `module-ui-${id}`;
  let el = document.getElementById(elId);
  if (!el) {
    el = document.createElement('div');
    el.id = elId;
    host.appendChild(el);
  }
  return el;
}

// A small styled UI toolkit so module client code doesn't hand-roll CSS and
// matches the core look (theme colors/radius/shadow).
function makeUi(container: HTMLElement) {
  const button = (label: string, onClick?: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      `background:${colors.primary};color:#fff;border:none;border-radius:${radius.sm}px;` +
      `padding:6px 10px;cursor:pointer;font:13px sans-serif;`;
    b.onmouseenter = () => (b.style.background = colors.primaryHover);
    b.onmouseleave = () => (b.style.background = colors.primary);
    if (onClick) b.onclick = onClick;
    return b;
  };

  const input = (placeholder = ''): HTMLInputElement => {
    const i = document.createElement('input');
    i.placeholder = placeholder;
    i.style.cssText =
      `width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid ${colors.border};` +
      `border-radius:${radius.sm}px;font:13px sans-serif;`;
    return i;
  };

  const flex = (dir: 'row' | 'column', ...children: Node[]): HTMLElement => {
    const d = document.createElement('div');
    d.style.cssText = `display:flex;flex-direction:${dir};gap:6px;`;
    d.append(...children);
    return d;
  };

  // A draggable, closable floating panel, hidden by default. Pair it with
  // ui.actionButton(...) so it opens from the Actions menu like the built-ins.
  const panel = (opts: { title?: string } = {}) => {
    const el = document.createElement('div');
    el.style.cssText =
      `position:fixed;top:90px;left:calc(50% - 120px);min-width:220px;display:none;` +
      `background:${colors.surface};color:${colors.text};border:1px solid ${colors.border};` +
      `border-radius:${radius.md}px;box-shadow:${shadow.panel};font:13px sans-serif;` +
      `overflow:hidden;z-index:${zIndex.floatingPanel};`;

    const header = document.createElement('div');
    header.style.cssText =
      `display:flex;align-items:center;justify-content:space-between;gap:12px;` +
      `padding:6px 10px;font-weight:bold;cursor:move;user-select:none;` +
      `border-bottom:1px solid ${colors.border};background:${colors.surfaceMuted};`;
    const titleEl = document.createElement('span');
    titleEl.textContent = opts.title ?? '';
    const closeEl = document.createElement('span');
    closeEl.textContent = '×';
    closeEl.style.cssText = 'cursor:pointer;padding:0 4px;font-size:16px;line-height:1;';
    header.append(titleEl, closeEl);

    const body = document.createElement('div');
    body.style.cssText = 'padding:10px 12px;display:flex;flex-direction:column;gap:6px;';
    el.append(header, body);
    container.append(el);

    const show = () => (el.style.display = 'block');
    const hide = () => (el.style.display = 'none');
    const isOpen = () => el.style.display !== 'none';
    closeEl.onclick = hide;

    // Drag by the header.
    let dragging = false;
    let offX = 0;
    let offY = 0;
    header.addEventListener('mousedown', (e) => {
      if (e.target === closeEl) return;
      const r = el.getBoundingClientRect();
      dragging = true;
      offX = e.clientX - r.left;
      offY = e.clientY - r.top;
      el.style.left = `${r.left}px`;
      el.style.top = `${r.top}px`;
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      el.style.left = `${e.clientX - offX}px`;
      el.style.top = `${e.clientY - offY}px`;
    });
    window.addEventListener('mouseup', () => (dragging = false));

    return {
      el,
      body,
      setTitle: (text: string) => (titleEl.textContent = text),
      setBody: (...nodes: Node[]) => body.replaceChildren(...nodes),
      show,
      hide,
      toggle: () => (isOpen() ? hide() : show()),
      isOpen,
      remove: () => el.remove(),
    };
  };

  return {
    button,
    input,
    row: (...c: Node[]) => flex('row', ...c),
    column: (...c: Node[]) => flex('column', ...c),
    panel,
    // A button in the in-game Actions menu, e.g. to toggle a panel. A
    // one-char hotkey adds a key badge and global shortcut like the built-ins
    // ("I" for Inventory).
    actionButton: (label: string, onClick: () => void, key?: string) =>
      registerModuleAction(label, onClick, key),
  };
}

function makeEngineApi(id: string) {
  const container = moduleContainer(id);
  return {
    onServerEvent,
    sendServerEvent,
    /** A DOM element this module owns; render UI into it. */
    mount: () => container,
    /** Styled UI helpers (panel/button/input/row/column) in the core look. */
    ui: makeUi(container),
    log: (...args: unknown[]) => console.log(`[module:${id}]`, ...args),
    warn: (...args: unknown[]) => console.warn(`[module:${id}]`, ...args),
    error: (...args: unknown[]) => console.error(`[module:${id}]`, ...args),
  };
}

export async function loadClientModules(): Promise<void> {
  let modules: ClientModule[];
  try {
    modules = await (await fetch('/modules')).json();
  } catch (e) {
    console.error('[modules] failed to fetch module list', e);
    return;
  }

  for (const m of modules) {
    try {
      const code = await (await fetch(`/modules/${m.id}/client`)).text();
      // eslint-disable-next-line no-new-func
      new Function('engine', code)(makeEngineApi(m.id));
      console.log(`[modules] client loaded: ${m.id}`);
    } catch (e) {
      console.error(`[modules] client "${m.id}" failed to load`, e);
    }
  }
}
