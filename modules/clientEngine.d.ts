// Types for the client-side `engine` object given to module scripts.

interface PanelApi {
  el: HTMLElement;
  body: HTMLElement;
  setTitle(title: string): void;
  setBody(...nodes: Node[]): void;
  show(): void;
  hide(): void;
  toggle(): void;
  isOpen(): boolean;
  remove(): void;
}

interface ModuleUi {
  /** Focus and contain Tab within a dialog; cleanup restores the opener. */
  focusDialog(element: HTMLElement): () => void;
  /** Whether keyboard focus is inside an editable field. */
  isInputActive(): boolean;
  panel(options?: { title?: string }): PanelApi;
  button(label: string, onClick?: () => void): HTMLButtonElement;
  input(placeholder?: string): HTMLInputElement;
  row(...children: Node[]): HTMLElement;
  column(...children: Node[]): HTMLElement;
  /**
   * Show a notice the module styled over the world for `ms` (3000), then
   * fade it out and remove it.
   */
  toast(element: HTMLElement, ms?: number): void;
  actionButton(label: string, onClick: () => void, hotkey?: string): HTMLButtonElement;
  /**
   * The window of `panel()` for a module drawn with `engine.render`: open
   * while rendered, so the module keeps whether it is open and renders it or
   * not. Translate the title with `engine.useT()`.
   *
   * @example open && <engine.ui.Window title={t('Guild')} onClose={close}>…</engine.ui.Window>
   */
  Window: (props: {
    title: string;
    /** In pixels; without it the window fits what it holds. */
    width?: number;
    onClose(): void;
    children?: React.ReactNode;
  }) => React.ReactElement;
}

/** Another player as the client knows them: no inventory, no stats. */
interface ClientPlayer {
  id: string;
  name: string;
  sprite: number;
  width: number;
  height: number;
  maxHealth: number;
  health: number;
  level: number;
  position: Position;
  direction: Direction;
  action: CharacterAction;
  nameColor?: string;
  nameTag?: string;
  nameTagColor?: string;
  kind: 'player';
}

/** The client's map, composed from static tiles and the per-tick update. */
interface ClientMapState {
  id: string;
  name: string;
  type: MapType;
  tiles: Tile[][];
  players: Record<string, ClientPlayer>;
  npcs: Record<string, RuntimeNpc>;
  droppedItems: { id: string; itemId: number; position: Position }[];
}

declare const engine: {
  onServerEvent(channel: string, handler: (payload: any) => void): void;
  sendServerEvent(channel: string, payload?: unknown): void;
  /** A DOM element this module owns; render UI into it. */
  mount(): HTMLElement;
  /**
   * Draw the module's React UI (the loader hands the module `React`, and a
   * `client.jsx` entry is compiled by the server), replacing what the last
   * call drew. Call it again whenever the module's own state changes; React
   * keeps what did not change, a half-typed input included.
   */
  render(node: React.ReactNode): void;
  /** `t` as a hook: the component re-renders on a language switch. */
  useT(): (text: string, params?: Record<string, string | number>) => string;
  /** Styled UI helpers (panel/button/input/row/column) in the core look. */
  ui: ModuleUi;
  /**
   * Declare this module's translations. The key is the English string the
   * module already draws, so a language with no entry for it renders that
   * English rather than nothing.
   *
   * @example engine.i18n({ pt: { Guild: 'Guilda' } });
   */
  i18n(tables: Record<string, Record<string, string>>): void;
  /**
   * Translate one string, filling `{placeholders}`. Text handed to the `ui`
   * helpers is translated already; this is for DOM the module builds itself,
   * and for any sentence carrying a value.
   *
   * @example engine.t('Quests ({count} active)', { count: list.length })
   */
  t(text: string, params?: Record<string, string | number>): string;
  /**
   * Register an action shown in the player context menu when another player
   * is clicked on the game canvas. `callback` receives the player's name.
   */
  registerPlayerAction(label: string, callback: (name: string) => void): void;
  /**
   * Append a system message to the chat log. Use for notifications that
   * should persist in the log (e.g. "kicked from guild", "trade complete").
   */
  chat(message: string): void;
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  /** Current local player state (position, health, stats). */
  getPlayer(): PlayerServer | undefined;
  /**
   * Visible map + entity state (players, npcs, droppedItems, tiles). Null
   * before the first world update arrives.
   */
  getGameState(): ClientMapState | null;
  /** Current camera offset in world-space pixels. */
  getCamera(): { x: number; y: number };
  /**
   * Convert a screen-space point (pixels from canvas top-left) to
   * world-space coordinates. Use this when handling canvas click/drag
   * events to find which tile or entity was hit.
   */
  screenToWorld(sx: number, sy: number): { x: number; y: number };
  /**
   * Convert a world-space point to screen-space. Use this to position
   * DOM overlays (tooltips, floating labels) above a world entity.
   */
  worldToScreen(wx: number, wy: number): { x: number; y: number };
  /** Tile size in pixels, for coordinate math and hit-testing. */
  TILE_SIZE: number;
  /**
   * Register a per-frame draw callback that runs in world-space on the
   * player canvas (above entities, below fringe tiles). The context
   * already has `translate(-cam.x, -cam.y)` applied, so drawing at a
   * tile position works directly. Returns an unregister function.
   */
  registerOverlay(
    fn: (ctx: CanvasRenderingContext2D, cam: { x: number; y: number }) => void,
    order?: number,
  ): () => void;
  /**
   * Draw order for `registerOverlay`. `world` (the default) sits under tree
   * tops and roofs; `scene` covers them too, for darkness, tints or rain;
   * `hud` sits above both and the names, for a minimap a tint must not dim.
   */
  OverlayLayer: { world: number; scene: number; hud: number };
};
