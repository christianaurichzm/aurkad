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
  panel(options?: { title?: string }): PanelApi;
  button(label: string, onClick?: () => void): HTMLButtonElement;
  input(placeholder?: string): HTMLInputElement;
  row(...children: Node[]): HTMLElement;
  column(...children: Node[]): HTMLElement;
  actionButton(label: string, onClick: () => void, hotkey?: string): HTMLButtonElement;
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
  /** Styled UI helpers (panel/button/input/row/column) in the core look. */
  ui: ModuleUi;
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
   * Draw order for `registerOverlay`. Anything on `hud` covers `world` (the
   * default), so a minimap or counter belongs there, where a day/night tint
   * cannot dim it.
   */
  OverlayLayer: { world: number; hud: number };
};
