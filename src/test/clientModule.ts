import { isInputActive } from '../client/utils/domHelpers';
import { focusDialog } from '../client/hooks/useDialogFocus';
import { ModuleWindow } from '../client/components/common/Modal';
import { SpellIcon } from '../client/components/HUD/Hotbar';
import { Sprite } from '../client/components/common/SpritePreview';
import { ItemIcon, ItemSlot } from '../client/components/Inventory/ItemIcon';
import { Stepper } from '../client/components/common/Stepper';
import { EmptyState } from '../client/components/common/EmptyState';
import type { HotbarSlot } from '../client/io/modules/moduleActions';
import { GAME_HEIGHT, GAME_WIDTH } from '../shared/constants';
import { readClientSource } from '../server/engine/modules/moduleLoader.js';
import { initTsSupport } from '../server/engine/scripting/loader.js';
import fs from 'node:fs';
import path from 'node:path';
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, vi } from 'vitest';

// The server compiles a client.jsx with the TypeScript it loads at boot.
initTsSupport();

// A module window left open would hold Escape into the next test.
const roots: Root[] = [];
afterEach(() => {
  React.act(() => roots.splice(0).forEach((root) => root.unmount()));
});

/**
 * Loads a module's real shipped browser half and captures what it draws.
 * That half is plain JavaScript run with an `engine` parameter (and
 * `React`), so there is no import to reach for. This runs the code the
 * server serves as the client loader does, the strict body of a function
 * of (engine, React), against a fake engine and a recording context.
 *
 * Drawing is not pixels: it answers "was the shutter half the slot", "did
 * the tint land in screen space", "which overlay drew first", questions
 * the calls themselves answer.
 */

export type DrawCall = { fn: string; args: unknown[] };

export type RecordingContext = {
  calls: DrawCall[];
  /** Every call to one method, in order. */
  of: (fn: string) => DrawCall[];
  ctx: CanvasRenderingContext2D;
};

const RECORDED = [
  'save',
  'restore',
  'translate',
  'scale',
  'rotate',
  'setTransform',
  'fillRect',
  'strokeRect',
  'clearRect',
  'fillText',
  'strokeText',
  'drawImage',
  'beginPath',
  'stroke',
  'fill',
  'arc',
  'moveTo',
  'lineTo',
  'closePath',
  'roundRect',
  'rect',
  'clip',
  'ellipse',
  'quadraticCurveTo',
] as const;

export function recordingContext(
  width = GAME_WIDTH,
  height = GAME_HEIGHT,
): RecordingContext {
  const calls: DrawCall[] = [];
  const target: Record<string, unknown> = {
    canvas: { width, height },
    // Assigned properties (fillStyle, font, ...) are kept as plain values so a
    // test can read the style in force when a call was recorded.
    fillStyle: '',
    strokeStyle: '',
    font: '',
    lineWidth: 1,
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    globalCompositeOperation: 'source-over',
    // Not recorded: it has to answer, and 6px per character is close enough
    // for the layout maths that reads it back.
    measureText: (text: string) => ({ width: text.length * 6 }),
    // The identity: the recorded transforms are not applied to a matrix.
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
  };

  for (const fn of RECORDED) {
    target[fn] = (...args: unknown[]) => {
      calls.push({ fn, args });
    };
  }

  return {
    calls,
    of: (fn) => calls.filter((c) => c.fn === fn),
    ctx: target as unknown as CanvasRenderingContext2D,
  };
}

export type OverlayFn = (
  ctx: CanvasRenderingContext2D,
  cam: { x: number; y: number },
) => void;

export type FakeEngine = {
  registerOverlay: (fn: OverlayFn, order?: number) => () => void;
  OverlayLayer: { world: number; scene: number; hud: number };
  worldText: (ctx: unknown, x: number, y: number, draw: () => void) => void;
  TILE_SIZE: number;
  getGameState: () => unknown;
  getPlayer: () => unknown;
  getCamera: () => { x: number; y: number };
  onServerEvent: (channel: string, handler: (payload: unknown) => void) => void;
  sendServerEvent: (channel: string, payload?: unknown) => void;
  ui: unknown;
  [key: string]: unknown;
};

/** A panel the module built, with the DOM it actually put in it. */
export type FakePanel = {
  body: HTMLElement;
  title: string;
  open: boolean;
};

export type LoadedClientModule = {
  /** Overlays the module registered, with the layer each asked for. */
  overlays: { fn: OverlayFn; order: number }[];
  /** Handlers the module attached with onServerEvent, by channel. */
  handlers: Map<string, (payload: unknown) => void>;
  /** Panels the module built, in the order it built them. */
  panels: FakePanel[];
  /** The element `engine.mount()` hands out, attached to the document. */
  container: HTMLElement;
  /** Action buttons it put in the player's panel, by label. */
  actions: Map<string, HTMLButtonElement>;
  /** The slots it last put on the hotbar. */
  hotbar: HotbarSlot[];
  engine: FakeEngine;
};

/**
 * Stand-ins for the ui helpers. `setBody` really replaces children, the way the
 * shipped one does (moduleClient.ts), because a module that builds DOM is only
 * testable if the DOM it built is somewhere a test can query.
 */
function fakeUi(
  panels: FakePanel[],
  actions: Map<string, HTMLButtonElement>,
  hotbar: HotbarSlot[],
  container: HTMLElement,
) {
  const el = () => document.createElement('div');
  const wire = (b: HTMLButtonElement, onClick?: () => void) => {
    if (onClick) b.addEventListener('click', onClick);
    return b;
  };
  const button = (label: string, onClick?: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    return wire(b, onClick);
  };
  const flex = (direction: string, ...children: Node[]) => {
    const box = el();
    box.style.flexDirection = direction;
    box.append(...children);
    return box;
  };

  return {
    isInputActive,
    focusDialog,
    panel: (options?: { title?: string }) => {
      const record: FakePanel = {
        body: el(),
        title: options?.title ?? '',
        open: false,
      };
      panels.push(record);
      return {
        el: el(),
        body: record.body,
        setTitle: (text: string) => {
          record.title = text;
        },
        setBody: (...nodes: Node[]) => record.body.replaceChildren(...nodes),
        show: () => {
          record.open = true;
        },
        hide: () => {
          record.open = false;
        },
        toggle: () => {
          record.open = !record.open;
        },
        isOpen: () => record.open,
        remove: vi.fn(),
      };
    },
    button,
    input: (placeholder?: string) => {
      const i = document.createElement('input');
      if (placeholder) i.placeholder = placeholder;
      return i;
    },
    row: (...c: Node[]) => flex('row', ...c),
    column: (...c: Node[]) => flex('column', ...c),
    // Into the module's own container, so a test reads a notice where it reads
    // the rest of what the module drew; gone on the shipped one's schedule.
    toast: (toastEl: HTMLElement, ms = 3000) => {
      container.append(toastEl);
      setTimeout(() => toastEl.remove(), ms + 400);
    },
    notice: (
      text: string,
      opts: {
        tone?: string;
        label?: string;
        detail?: string;
        ms?: number;
      } = {},
    ) => {
      const n = el();
      n.className = 'notice';
      if (opts.tone) n.dataset.tone = opts.tone;
      n.append(
        ...[opts.label, text, opts.detail].filter((t): t is string => !!t),
      );
      container.append(n);
      setTimeout(() => n.remove(), (opts.ms ?? 3000) + 400);
    },
    actionButton: (label: string, onClick: () => void) => {
      const b = button(label, onClick);
      actions.set(label, b);
      return b;
    },
    hotbar: (slots: HotbarSlot[]) => hotbar.splice(0, hotbar.length, ...slots),
    Window: ModuleWindow,
    SpellIcon,
    Sprite,
    ItemSlot,
    ItemIcon,
    Stepper,
    EmptyState,
  };
}

export function loadClientModule(
  id: string,
  overrides: Partial<FakeEngine> = {},
): LoadedClientModule {
  const overlays: LoadedClientModule['overlays'] = [];
  const handlers = new Map<string, (payload: unknown) => void>();
  const panels: FakePanel[] = [];
  const actions = new Map<string, HTMLButtonElement>();
  const hotbar: HotbarSlot[] = [];
  // One container per module, attached and stable across calls, like the
  // real mount(); a fresh detached div per call would swallow anything a
  // module appends to it.
  const container = document.createElement('div');
  document.body.append(container);

  let root: Root | undefined;
  const t = (text: string, params?: Record<string, string | number>) =>
    params
      ? text.replace(/\{(\w+)\}/g, (whole, name: string) =>
          name in params ? String(params[name]) : whole,
        )
      : text;

  const engine: FakeEngine = {
    registerOverlay: (fn, order = 0) => {
      overlays.push({ fn, order });
      return () => {
        const i = overlays.findIndex((o) => o.fn === fn);
        if (i >= 0) overlays.splice(i, 1);
      };
    },
    OverlayLayer: { world: 0, scene: 50, hud: 100 },
    worldText: (_ctx, _x, _y, draw) => draw(),
    TILE_SIZE: 64,
    GAME_WIDTH,
    GAME_HEIGHT,
    getVisibleView: () => ({
      x: 0,
      y: 0,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      scale: 1,
    }),
    getGameState: () => null,
    getPlayer: () => undefined,
    usePlayer: () => engine.getPlayer(),
    getCamera: () => ({ x: 0, y: 0 }),
    onServerEvent: (channel, handler) => handlers.set(channel, handler),
    sendServerEvent: vi.fn(),
    ui: fakeUi(panels, actions, hotbar, container),
    // The English passes through, as the real one does for a language with no
    // entry, so a test asserting on a label reads what ships.
    i18n: vi.fn(),
    t,
    useT: () => t,
    mount: () => container,
    // The real renderer, flushed at once so a test reads what an event drew.
    render: (node: React.ReactNode) =>
      React.act(() => {
        if (!root) {
          const el = document.createElement('div');
          container.append(el);
          root = createRoot(el);
          roots.push(root);
        }
        root.render(node);
      }),
    chat: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    registerPlayerAction: vi.fn(),
    screenToWorld: (x: number, y: number) => ({ x, y }),
    worldToScreen: (x: number, y: number) => ({ x, y }),
    ...overrides,
  };

  const dir = path.join(process.cwd(), 'modules', id);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dir, 'module.json'), 'utf-8'),
  ) as { client: string };
  const code = readClientSource(path.join(dir, manifest.client));
  // Run as the real client loader runs it (io/modules/moduleClient.ts): the
  // body of an ES module's default export, called with (engine, React), a
  // strict function as module code always is. Run sloppy, a test would pass
  // code the shipped loader throws on.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
  new Function('engine', 'React', `'use strict';${code}`)(engine, React);

  return { overlays, handlers, panels, actions, hotbar, container, engine };
}
