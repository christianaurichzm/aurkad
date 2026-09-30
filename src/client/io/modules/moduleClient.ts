import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { claimEscape } from '../../hooks/useEscapeClose';
import { focusDialog } from '../../hooks/useDialogFocus';
import { isInputActive } from '../../utils/domHelpers';
import { onServerEvent, sendServerEvent } from '../network/customEvents';
import {
  moduleText,
  t,
  onLanguageChange,
  registerModuleStrings,
  useModuleText,
} from '../../i18n';
import { ModuleWindow } from '../../components/common/Modal';
import { SpellIcon } from '../../components/HUD/Hotbar';
import {
  registerModuleAction,
  setHotbar,
  type HotbarSlot,
} from './moduleActions';
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
  menu.className = 'player-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const title = document.createElement('div');
  title.className = 'player-menu-title';
  title.textContent = name;
  menu.appendChild(title);

  for (const action of playerActions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    setText(btn, action.label);
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

// Notices over the world, centred under the map name. All modules share one
// stack, so two in the same tick (a kill that ends a quest and earns an
// achievement) stack up. It must sit above the dimming of an open window,
// since a dialog choice starts a quest, so it hangs off the body: inside the
// frame, size containment makes a stacking context no z-index escapes.
function toast(el: HTMLElement, ms = 3000, fallback: HTMLElement): void {
  const frame = document.getElementById('canvasFrame');
  let stack = document.querySelector<HTMLElement>('body > .module-toasts');
  if (frame && !stack) {
    stack = document.createElement('div');
    stack.className = 'module-toasts';
    document.body.append(stack);
  }
  if (frame && stack) {
    // Placed as each notice lands, so a resize while one is up
    // leaves it where the frame was until the next.
    const box = frame.getBoundingClientRect();
    stack.style.left = `${box.left + box.width / 2}px`;
    stack.style.top = `${box.top + 44}px`;
  }
  (stack ?? fallback).append(el);
  setTimeout(() => (el.style.opacity = '0'), ms);
  setTimeout(() => el.remove(), ms + 400);
}

// A small UI toolkit so module code doesn't hand-roll CSS. It styles nothing
// itself: panels wear the React Modal's classes and controls take the
// stylesheet's defaults, so module and core windows match.
let nextPanelId = 0;

function makeUi(id: string, container: HTMLElement) {
  const button = (label: string, onClick?: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    setText(b, label);
    if (onClick) b.onclick = onClick;
    return b;
  };

  const input = (placeholder = ''): HTMLInputElement => {
    const i = document.createElement('input');
    setPlaceholder(i, placeholder);
    // Fills its row; a module narrows the short ones (a quantity) itself.
    i.style.width = '100%';
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
    el.className = 'editor-window module-panel';
    el.setAttribute('role', 'dialog');
    el.tabIndex = -1;
    el.style.cssText = 'display:none;top:90px;left:calc(50% - 120px);';

    const header = document.createElement('div');
    header.className = 'window-titlebar';
    const titleEl = document.createElement('h2');
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
    // The markup <Icon name="close" /> renders, for the same close as a Modal.
    const closeIcon = document.createElement('span');
    closeIcon.className = 'icon icon-close';
    closeIcon.setAttribute('aria-hidden', 'true');
    closeIcon.style.setProperty('--icon', 'var(--icon-close)');
    closeEl.append(closeIcon);
    header.append(titleEl, closeEl);

    const body = document.createElement('div');
    body.className = 'window-content';
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
    // The same, in the stylesheet's look: the tone picks the paint, and a
    // theme restyles every module's notices through .notice at once.
    notice: (
      text: string,
      opts: {
        tone?: 'primary' | 'danger' | 'warning' | 'highlight';
        label?: string;
        detail?: string;
        ms?: number;
      } = {},
    ) => {
      const el = document.createElement('div');
      el.className = 'notice';
      if (opts.tone) el.dataset.tone = opts.tone;
      const line = (className: string, source: string) => {
        const d = document.createElement('div');
        d.className = className;
        d.textContent = moduleText(source);
        return d;
      };
      if (opts.label) el.append(line('notice-label', opts.label));
      el.append(moduleText(text));
      if (opts.detail) el.append(line('notice-detail', opts.detail));
      toast(el, opts.ms, container);
    },
    // A tile in the in-game Actions menu, e.g. to toggle a panel. A one-char
    // hotkey adds a key badge and global shortcut like the built-ins; an icon
    // name draws on the tile; an order places it among the others.
    actionButton: (
      label: string,
      onClick: () => void,
      key?: string,
      icon?: string,
      order?: number,
    ) => registerModuleAction(label, onClick, key, icon, order),
    // This module's slots on the bar along the bottom of the world, replacing
    // the ones it set before; [] takes them off.
    hotbar: (slots: HotbarSlot[]) => setHotbar(id, slots),
    // The window panel() builds, as a component for engine.render.
    Window: ModuleWindow,
    // A spell's picture as the hotbar draws it, for a module's own windows.
    SpellIcon,
  };
}

function makeEngineApi(id: string) {
  const container = moduleContainer(id);
  // In a div of its own: React empties the element it renders into, and the
  // container also holds what the DOM toolkit built.
  let root: Root | undefined;
  return {
    onServerEvent,
    sendServerEvent,
    /** A DOM element this module owns; render UI into it. */
    mount: () => container,
    /**
     * Draw the module's React UI, replacing what the last call drew. Call it
     * again whenever the module's own state changes (a server event, a
     * toggle); React keeps what did not change, a half-typed input included.
     */
    render: (node: React.ReactNode) => {
      if (!root) {
        const el = document.createElement('div');
        container.append(el);
        root = createRoot(el);
      }
      root.render(node);
    },
    /** engine.t as a hook: the component re-renders on a language switch. */
    useT: useModuleText,
    /** Styled UI helpers (panel/button/input/row/column) in the core look. */
    ui: makeUi(id, container),
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
     * Draw order for registerOverlay. `world` (the default) sits under tree
     * tops and roofs; `scene` covers them too, for darkness, a tint or rain;
     * `hud` sits above both and the names, so a tint never dims a minimap.
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

  // A module's client half is the server owner's code (see the trust model
  // in the server's sandbox.ts), served as an ES module exporting a function
  // of (engine, React). Importing it from our own origin satisfies the CSP's
  // script-src 'self'; evaluating a fetched string would need 'unsafe-eval'.
  //
  // Fetched together and run in list order, which puts dependencies first.
  type Run = (
    engine: ReturnType<typeof makeEngineApi>,
    react: typeof React,
  ) => void;
  const loaded = await Promise.all(
    modules.map((m) =>
      import(/* @vite-ignore */ `/modules/${m.id}/client`).then(
        (mod: { default: Run }) => ({ id: m.id, run: mod.default }),
        (e: unknown) => {
          console.error(`[modules] client "${m.id}" failed to load`, e);
          return undefined;
        },
      ),
    ),
  );
  for (const entry of loaded) {
    if (!entry) continue;
    try {
      entry.run(makeEngineApi(entry.id), React);
      console.log(`[modules] client loaded: ${entry.id}`);
    } catch (e) {
      console.error(`[modules] client "${entry.id}" failed to load`, e);
    }
  }
}
