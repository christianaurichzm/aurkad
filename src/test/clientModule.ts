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

export type LoadedClientModule = {
  /** Overlays the module registered, with the layer each asked for. */
  overlays: { fn: OverlayFn; order: number }[];
  /** Handlers the module attached with onServerEvent, by channel. */
  handlers: Map<string, (payload: unknown) => void>;
  engine: FakeEngine;
};

/** Minimal ui helper stand-ins, so a module that builds a panel loads. */
function fakeUi() {
  const el = () => document.createElement('div');
  return {
    panel: () => ({
      el: el(),
      body: el(),
      setTitle: vi.fn(),
      setBody: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      toggle: vi.fn(),
      isOpen: () => false,
      remove: vi.fn(),
    }),
    button: (label: string) => {
      const b = document.createElement('button');
      b.textContent = label;
      return b;
    },
    input: () => document.createElement('input'),
    row: el,
    column: el,
    actionButton: (label: string) => {
      const b = document.createElement('button');
      b.textContent = label;
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
    ui: fakeUi(),
    // The English passes through, as the real one does for a language with no
    // entry, so a test asserting on a label reads what ships.
    i18n: vi.fn(),
    t: (text: string, params?: Record<string, string | number>) =>
      params
        ? text.replace(/\{(\w+)\}/g, (whole, name: string) =>
            name in params ? String(params[name]) : whole,
          )
        : text,
    mount: () => document.createElement('div'),
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

  return { overlays, handlers, engine };
}
