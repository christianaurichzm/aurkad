import { onServerEvent, sendServerEvent } from '../network/customEvents';
import { colors, radius, shadow } from '../../theme';

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

type Anchor = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

const anchorCss: Record<Anchor, string> = {
  'top-left': 'top:12px;left:12px;',
  'top-right': 'top:12px;right:12px;',
  'bottom-left': 'bottom:12px;left:12px;',
  'bottom-right': 'bottom:12px;right:12px;',
};

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

  const panel = (opts: { title?: string; anchor?: Anchor } = {}) => {
    const el = document.createElement('div');
    el.style.cssText =
      `position:absolute;${anchorCss[opts.anchor ?? 'bottom-left']}min-width:180px;` +
      `background:${colors.surface};color:${colors.text};border:1px solid ${colors.border};` +
      `border-radius:${radius.md}px;box-shadow:${shadow.panel};font:13px sans-serif;overflow:hidden;`;

    let header: HTMLElement | null = null;
    if (opts.title) {
      header = document.createElement('div');
      header.textContent = opts.title;
      header.style.cssText =
        `padding:8px 12px;font-weight:bold;border-bottom:1px solid ${colors.border};` +
        `background:${colors.surfaceMuted};`;
      el.append(header);
    }

    const body = document.createElement('div');
    body.style.cssText = 'padding:10px 12px;display:flex;flex-direction:column;gap:6px;';
    el.append(body);
    container.append(el);

    return {
      el,
      body,
      setTitle: (text: string) => header && (header.textContent = text),
      setBody: (...nodes: Node[]) => body.replaceChildren(...nodes),
      show: () => (el.style.display = ''),
      hide: () => (el.style.display = 'none'),
      remove: () => el.remove(),
    };
  };

  return { button, input, row: (...c: Node[]) => flex('row', ...c), column: (...c: Node[]) => flex('column', ...c), panel };
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
