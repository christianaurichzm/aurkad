import { claimEscape } from '../../hooks/useEscapeClose';
import { focusDialog } from '../../hooks/useDialogFocus';
import { isInputActive } from '../../utils/domHelpers';
import { onServerEvent, sendServerEvent } from '../network/customEvents';
import { colors, radius, shadow, zIndex } from '../../theme';
import {
  moduleText,
  t,
  onLanguageChange,
  registerModuleStrings,
} from '../../i18n';
import { registerModuleAction } from './moduleActions';
import { getGameState, getPlayer } from '../../core/gameState';
import { enqueueChatMessage } from '../network/sync/chatSync';
import { TILE_SIZE } from '../../../shared/constants';
import { getCamera, screenToWorld, worldToScreen } from '../../graphics/camera';
import { OverlayLayer, registerOverlay } from '../../graphics/overlayRegistry';

// Loads the module browser entries the server serves and runs them with an
// `engine` API. Like server scripts, this is the server owner's code, so it
// runs with no sandbox.

// ---------- translated text --------------------------------------------------

// Text the toolkit drew keeps its English on the element, so a language
// switch re-applies the table to what is on screen. The DOM forgets an
// element once it leaves, so there is no registry to sweep.
function setText(el: HTMLElement, source: string): void {
  el.dataset.i18n = source;
  el.textContent = moduleText(source);
}

function setPlaceholder(el: HTMLInputElement, source: string): void {
  el.dataset.i18nPlaceholder = source;
  el.placeholder = moduleText(source);
}

onLanguageChange(() => {
  document
    .querySelectorAll<HTMLElement>('[data-i18n]')
    .forEach((el) => (el.textContent = moduleText(el.dataset.i18n ?? '')));
  document
    .querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')
    .forEach(
      (el) => (el.placeholder = moduleText(el.dataset.i18nPlaceholder ?? '')),
    );
});

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
    setText(btn, action.label);
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

// Notices over the world, centred on it under the map name. Every module's
// share one stack, so two landing in the same tick (a first kill that finishes
// a quest and earns an achievement) sit one under the other. The stack lives
// in the world's frame, above the dimming an open window puts over the page:
// a dialog choice is what starts a quest, and its window is still up then.
function toast(el: HTMLElement, ms = 3000, fallback: HTMLElement): void {
  const frame = document.getElementById('canvasFrame');
  let stack = frame?.querySelector<HTMLElement>(':scope > .module-toasts');
  if (frame && !stack) {
    stack = document.createElement('div');
    stack.className = 'module-toasts';
    stack.style.cssText =
      'position:absolute;top:44px;left:50%;transform:translateX(-50%);' +
      'display:flex;flex-direction:column;align-items:center;gap:8px;' +
      `pointer-events:none;z-index:${zIndex.toast};`;
    frame.append(stack);
  }
  el.style.transition = 'opacity .4s';
  (stack ?? fallback).append(el);
  setTimeout(() => (el.style.opacity = '0'), ms);
  setTimeout(() => el.remove(), ms + 400);
}

// A small styled UI toolkit so module client code doesn't hand-roll CSS and
// matches the core look (theme colors/radius/shadow).
let nextPanelId = 0;

function makeUi(container: HTMLElement) {
  const button = (label: string, onClick?: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    setText(b, label);
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
    setPlaceholder(i, placeholder);
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
    el.className = 'module-panel';
    el.setAttribute('role', 'dialog');
    el.tabIndex = -1;
    el.style.cssText =
      `position:fixed;top:90px;left:calc(50% - 120px);min-width:220px;` +
      `max-width:calc(100vw - 16px);max-height:calc(100dvh - 16px);` +
      `background:${colors.surface};color:${colors.text};border:1px solid ${colors.border};` +
      `border-radius:${radius.md}px;box-shadow:${shadow.panel};font:13px sans-serif;` +
      `display:none;flex-direction:column;overflow:hidden;z-index:${zIndex.floatingPanel};`;

    const header = document.createElement('div');
    header.className = 'window-titlebar';
    header.style.cssText =
      `display:flex;align-items:center;justify-content:space-between;gap:12px;` +
      `padding:6px 10px;font-weight:bold;cursor:move;user-select:none;` +
      // The pointer has to belong to the drag, or the browser scrolls the page
      // with it and cancels the gesture, and a finger cannot move the panel.
      `touch-action:none;flex-shrink:0;` +
      `border-bottom:1px solid ${colors.border};background:${colors.surfaceMuted};`;
    const titleEl = document.createElement('span');
    titleEl.id = `module-panel-${++nextPanelId}`;
    el.setAttribute('aria-labelledby', titleEl.id);
    setText(titleEl, opts.title ?? '');
    const closeEl = document.createElement('button');
    closeEl.type = 'button';
    closeEl.className = 'window-close';
    closeEl.setAttribute('aria-label', t('common.close'));
    const unsubscribeCloseLabel = onLanguageChange(() =>
      closeEl.setAttribute('aria-label', t('common.close')),
    );
    closeEl.textContent = '×';
    closeEl.style.cssText =
      'cursor:pointer;padding:0 4px;font-size:16px;line-height:1;';
    header.append(titleEl, closeEl);

    const body = document.createElement('div');
    body.style.cssText =
      'padding:10px 12px;display:flex;flex-direction:column;gap:6px;' +
      // A list of mail or auctions is as long as it is; the panel scrolls it
      // rather than growing past the bottom of a phone.
      'overflow:auto;min-height:0;';
    el.append(header, body);
    container.append(el);

    // While open the panel owns Escape and keeps Tab inside it; both claims
    // are released on the way out, focus going back to whatever had it.
    let release: (() => void) | undefined;
    const hide = () => {
      el.style.display = 'none';
      release?.();
      release = undefined;
    };
    const show = () => {
      if (release) return;
      el.style.display = 'flex';
      const releaseEscape = claimEscape(hide);
      const releaseFocus = focusDialog(el);
      release = () => {
        releaseEscape();
        releaseFocus();
      };
    };
    const isOpen = () => !!release;
    closeEl.onclick = hide;

    // Drag by the header with pointer events, since a finger sends no mouse
    // events until the tap ends. Clamped to the viewport like the React
    // panels, so a panel dragged off the edge can come back.
    let dragging = false;
    let offX = 0;
    let offY = 0;
    const moveTo = (clientX: number, clientY: number) => {
      const { width, height } = el.getBoundingClientRect();
      const x = Math.min(
        Math.max(8, clientX - offX),
        Math.max(8, window.innerWidth - width - 8),
      );
      const y = Math.min(
        Math.max(8, clientY - offY),
        Math.max(8, window.innerHeight - height - 8),
      );
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    };
    header.addEventListener('pointerdown', (e) => {
      if (
        e.target === closeEl ||
        window.matchMedia(
          '(max-width: 700px), (pointer: coarse) and (max-height: 600px)',
        ).matches
      )
        return;
      const r = el.getBoundingClientRect();
      dragging = true;
      offX = e.clientX - r.left;
      offY = e.clientY - r.top;
      el.style.left = `${r.left}px`;
      el.style.top = `${r.top}px`;
      header.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    const onPointerMove = (e: PointerEvent) => {
      if (dragging) moveTo(e.clientX, e.clientY);
    };
    window.addEventListener('pointermove', onPointerMove);
    const stopDragging = () => (dragging = false);
    window.addEventListener('pointerup', stopDragging);
    window.addEventListener('pointercancel', stopDragging);

    return {
      el,
      body,
      setTitle: (text: string) => setText(titleEl, text),
      setBody: (...nodes: Node[]) => body.replaceChildren(...nodes),
      show,
      hide,
      toggle: () => (isOpen() ? hide() : show()),
      isOpen,
      remove: () => {
        hide();
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', stopDragging);
        window.removeEventListener('pointercancel', stopDragging);
        unsubscribeCloseLabel();
        el.remove();
      },
    };
  };

  return {
    focusDialog,
    isInputActive,
    button,
    input,
    row: (...c: Node[]) => flex('row', ...c),
    column: (...c: Node[]) => flex('column', ...c),
    panel,
    // A notice the module styled, shown over the world for `ms` and then
    // faded out and removed.
    toast: (el: HTMLElement, ms?: number) => toast(el, ms, container),
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
     * Declare this module's translations. The key is the English string the
     * module already draws, so a language with no entry for it renders that
     * English rather than nothing.
     *
     * @example engine.i18n({ pt: { Guild: 'Guilda' } });
     */
    i18n: registerModuleStrings,
    /**
     * Translate one string, filling `{placeholders}`. `ui` helpers translate on
     * their own; this is for DOM the module builds and sentences with values.
     * The result does not follow a language switch until the module redraws it.
     *
     * @example engine.t('Quests ({count} active)', { count: list.length })
     */
    t: moduleText,
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
      order?: number,
    ) => registerOverlay(fn, order),
    /**
     * Draw order for registerOverlay. Anything on `hud` covers `world` (the
     * default), so a minimap or counter belongs there, where a day/night tint
     * cannot dim it.
     */
    OverlayLayer,
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
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
      new Function('engine', code)(makeEngineApi(m.id));
      console.log(`[modules] client loaded: ${m.id}`);
    } catch (e) {
      console.error(`[modules] client "${m.id}" failed to load`, e);
    }
  }
}
