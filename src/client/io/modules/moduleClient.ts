import { onServerEvent, sendServerEvent } from '../network/customEvents';
import { colors, radius, shadow, zIndex } from '../../theme';
import { registerModuleAction } from './moduleActions';
import { getGameState, getPlayer } from '../../core/gameState';
import { enqueueChatMessage } from '../network/sync/chatSync';
import { TILE_SIZE } from '../../../shared/constants';
import { getCamera, screenToWorld, worldToScreen } from '../../graphics/camera';
import { registerOverlay } from '../../graphics/overlayRegistry';

// Loads the module browser entries the server serves and runs them with an
// `engine` API. Like server scripts, this is the server owner's code, so it
// runs with no sandbox.

// ---------- player context menu ----------------------------------------------

interface PlayerAction {
  label: string;
  callback: (playerName: string) => void;
}

const playerActions: PlayerAction[] = [];
let contextMenu: HTMLElement | null = null;
let canvasClickInstalled = false;

function hideContextMenu() {
  contextMenu?.remove();
  contextMenu = null;
}

function showContextMenu(name: string, x: number, y: number) {
  hideContextMenu();
  if (!playerActions.length) return;

  const menu = document.createElement('div');
  menu.style.cssText =
    `position:fixed;left:${x}px;top:${y}px;z-index:${zIndex.floatingPanel};` +
    `background:${colors.surface};border:1px solid ${colors.border};` +
    `border-radius:${radius.md}px;box-shadow:${shadow.panel};` +
    `display:flex;flex-direction:column;gap:4px;padding:6px;min-width:160px;font:13px sans-serif;`;

  const title = document.createElement('div');
  title.textContent = name;
  title.style.cssText = `font-weight:bold;padding:2px 4px;border-bottom:1px solid ${colors.border};margin-bottom:2px;`;
  menu.appendChild(title);

  for (const action of playerActions) {
    const btn = document.createElement('button');
    btn.textContent = action.label;
    btn.style.cssText =
      `background:transparent;border:none;color:${colors.text};padding:5px 8px;` +
      `text-align:left;cursor:pointer;border-radius:${radius.sm}px;width:100%;`;
    btn.onmouseenter = () => (btn.style.background = colors.surfaceMuted);
    btn.onmouseleave = () => (btn.style.background = 'transparent');
    btn.onclick = () => {
      action.callback(name);
      hideContextMenu();
    };
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);
  contextMenu = menu;
  setTimeout(() => {
    const close = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) {
        hideContextMenu();
        document.removeEventListener('mousedown', close);
      }
    };
    document.addEventListener('mousedown', close);
  }, 0);
}

function installCanvasClickDetection() {
  if (canvasClickInstalled) return;
  canvasClickInstalled = true;
  // fringeCanvas sits on top in DOM order and captures events first; use the
  // canvasStack parent so bubbling from any layer reaches the listener.
  const tryInstall = () => {
    const stack = document.getElementById('canvasStack');
    const refCanvas = document.getElementById(
      'playerCanvas',
    ) as HTMLCanvasElement | null;
    if (!stack || !refCanvas) {
      setTimeout(tryInstall, 500);
      return;
    }
    stack.addEventListener('click', (e: MouseEvent) => {
      if (!playerActions.length) return;
      const rect = stack.getBoundingClientRect();
      // refCanvas gives the logical canvas dimensions (1280×896)
      const scaleX = refCanvas.width / rect.width;
      const scaleY = refCanvas.height / rect.height;
      const sx = (e.clientX - rect.left) * scaleX;
      const sy = (e.clientY - rect.top) * scaleY;
      const { x: cx, y: cy } = screenToWorld(sx, sy);
      const state = getGameState();
      if (!state) return;
      let hit: string | null = null;
      for (const p of Object.values(state.players)) {
        const px = p.position.x;
        const py = p.position.y;
        if (
          cx >= px &&
          cx <= px + TILE_SIZE &&
          cy >= py &&
          cy <= py + TILE_SIZE
        ) {
          hit = p.name;
          break;
        }
      }
      if (hit) showContextMenu(hit, e.clientX + 8, e.clientY);
      else hideContextMenu();
    });
  };
  tryInstall();
}

// ---------- module API -------------------------------------------------------

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
    closeEl.style.cssText =
      'cursor:pointer;padding:0 4px;font-size:16px;line-height:1;';
    header.append(titleEl, closeEl);

    const body = document.createElement('div');
    body.style.cssText =
      'padding:10px 12px;display:flex;flex-direction:column;gap:6px;';
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
    /**
     * Register an action shown in the player context menu when another player
     * is clicked on the game canvas. `callback` receives the player's name.
     */
    registerPlayerAction: (label: string, callback: (name: string) => void) => {
      playerActions.push({ label, callback });
      installCanvasClickDetection();
    },
    /**
     * Append a system message to the chat log. Use for notifications that
     * should persist in the log (e.g. "kicked from guild", "trade complete").
     */
    chat: (message: string) => {
      enqueueChatMessage({ type: 'chat', scope: 'global', message });
    },
    log: (...args: unknown[]) => console.log(`[module:${id}]`, ...args),
    warn: (...args: unknown[]) => console.warn(`[module:${id}]`, ...args),
    error: (...args: unknown[]) => console.error(`[module:${id}]`, ...args),
    /** Current local player state (position, health, stats). */
    getPlayer: () => getPlayer(),
    /** Visible map + entity state (players, npcs, droppedItems, tiles). */
    getGameState: () => getGameState(),
    /** Current camera offset in world-space pixels. */
    getCamera: () => ({ ...getCamera() }),
    /**
     * Convert a screen-space point (pixels from canvas top-left) to
     * world-space coordinates. Use this when handling canvas click/drag
     * events to find which tile or entity was hit.
     */
    screenToWorld: (sx: number, sy: number) => screenToWorld(sx, sy),
    /**
     * Convert a world-space point to screen-space. Use this to position
     * DOM overlays (tooltips, floating labels) above a world entity.
     */
    worldToScreen: (wx: number, wy: number) => worldToScreen(wx, wy),
    /** Tile size in pixels, for coordinate math and hit-testing. */
    TILE_SIZE,
    /**
     * Register a per-frame draw callback that runs in world-space on the
     * player canvas (above entities, below fringe tiles). The context
     * already has `translate(-cam.x, -cam.y)` applied, so drawing at a
     * tile position works directly. Returns an unregister function.
     *
     * @example
     * const stop = engine.registerOverlay((ctx, cam) => {
     *   ctx.fillStyle = 'rgba(255,0,0,0.3)';
     *   ctx.fillRect(targetX, targetY, 64, 64);
     * });
     */
    registerOverlay: (
      fn: (
        ctx: CanvasRenderingContext2D,
        cam: { x: number; y: number },
      ) => void,
    ) => registerOverlay(fn),
  };
}

export async function loadClientModules(): Promise<void> {
  let modules: ClientModule[];
  try {
    modules = (await (await fetch('/modules')).json()) as ClientModule[];
  } catch (e) {
    console.error('[modules] failed to fetch module list', e);
    return;
  }

  for (const m of modules) {
    try {
      const code = await (await fetch(`/modules/${m.id}/client`)).text();
      // A module's client half is the server owner's own code, served by
      // this server (see the trust model in the server's sandbox.ts). There is
      // no other way to run code fetched at runtime.
      // eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
      new Function('engine', code)(makeEngineApi(m.id));
      console.log(`[modules] client loaded: ${m.id}`);
    } catch (e) {
      console.error(`[modules] client "${m.id}" failed to load`, e);
    }
  }
}
