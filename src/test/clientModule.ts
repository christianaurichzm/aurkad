import { isInputActive } from '../client/utils/domHelpers';
import { focusDialog } from '../client/hooks/useDialogFocus';
import fs from 'node:fs';
import path from 'node:path';
import { vi } from 'vitest';

/**
 * Loads a module's real shipped browser half and captures what it draws.
 * That half is plain JavaScript run with a single `engine` global, so there
 * is no import to reach for. This calls `new Function('engine', code)`
 * like the client loader, with a fake engine and a recording context.
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

export function recordingContext(width = 800, height = 600): RecordingContext {
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
  OverlayLayer: { world: number; hud: number };
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
  engine: FakeEngine;
};

/**
 * Stand-ins for the ui helpers. `setBody` really replaces children, the way the
 * shipped one does (moduleClient.ts), because a module that builds DOM is only
 * testable if the DOM it built is somewhere a test can query.
 */
function fakeUi(panels: FakePanel[], actions: Map<string, HTMLButtonElement>) {
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
    actionButton: (label: string, onClick: () => void) => {
      const b = button(label, onClick);
      actions.set(label, b);
      return b;
    },
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
  // One container per module, attached and stable across calls, like the
  // real mount(); a fresh detached div per call would swallow anything a
  // module appends to it.
  const container = document.createElement('div');
  document.body.append(container);

  const engine: FakeEngine = {
    registerOverlay: (fn, order = 0) => {
      overlays.push({ fn, order });
      return () => {
        const i = overlays.findIndex((o) => o.fn === fn);
        if (i >= 0) overlays.splice(i, 1);
      };
    },
    OverlayLayer: { world: 0, hud: 100 },
    TILE_SIZE: 64,
    getGameState: () => null,
    getPlayer: () => undefined,
    getCamera: () => ({ x: 0, y: 0 }),
    onServerEvent: (channel, handler) => handlers.set(channel, handler),
    sendServerEvent: vi.fn(),
    ui: fakeUi(panels, actions),
    // The English passes through, as the real one does for a language with no
    // entry, so a test asserting on a label reads what ships.
    i18n: vi.fn(),
    t: (text: string, params?: Record<string, string | number>) =>
      params
        ? text.replace(/\{(\w+)\}/g, (whole, name: string) =>
            name in params ? String(params[name]) : whole,
          )
        : text,
    mount: () => container,
    chat: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    registerPlayerAction: vi.fn(),
    screenToWorld: (x: number, y: number) => ({ x, y }),
    worldToScreen: (x: number, y: number) => ({ x, y }),
    ...overrides,
  };

  const file = path.join(process.cwd(), 'modules', id, 'client.js');
  const code = fs.readFileSync(file, 'utf-8');
  // The same call the real client loader makes (io/modules/moduleClient.ts):
  // a test that imported the file some other way would be testing a loading
  // path that does not ship.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
  new Function('engine', code)(engine);

  return { overlays, handlers, panels, actions, container, engine };
}
