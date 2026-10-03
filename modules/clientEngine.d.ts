// Types for the client-side `engine` object given to module scripts.

/** The pictures the engine draws; a theme repaints one with `--icon-<name>`. */
type ActionIcon =
  | 'bag'
  | 'stats'
  | 'players'
  | 'quest'
  | 'friends'
  | 'trade'
  | 'guild'
  | 'trophy'
  | 'mail'
  | 'ranking'
  | 'spellbook'
  | 'party'
  | 'auction'
  | 'attack'
  | 'interact'
  | 'pickup'
  | 'run'
  | 'settings';

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

interface HotbarSlot {
  id: string;
  name: string;
  /** A line under the name in the slot's tooltip. */
  description?: string;
  /** The KeyboardEvent.key that uses it (`'F1'`). */
  key?: string;
  /** A tile of the spell sheet; without one the slot shows the name's initial. */
  icon?: number;
  /** Mana, shown on the slot. */
  cost?: number;
  /** `Date.now()` at which the cooldown ends. */
  readyAt?: number;
  /** The whole cooldown, so the slot shows the share of it left. */
  cooldownMs?: number;
  noMana?: boolean;
  /** Aimed at the player's side (a heal): a green border and a cross. */
  friendly?: boolean;
  onUse(): void;
}

/** What the engine's item components draw an item from. */
type ItemLook = Pick<ItemData, 'name' | 'sprite' | 'type'> & {
  effects?: ItemData['effects'];
};

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
  /**
   * The same notice in the stylesheet's look (`.notice`, painted by `tone`), so
   * a theme restyles it with every other module's. `label` is a small line
   * above the text, `detail` a lighter one under it; all three are translated
   * like the other `ui` labels.
   *
   * @example ui.notice(engine.t('New quest: {quest}', { quest: name }), { tone: 'warning' })
   */
  notice(
    text: string,
    options?: {
      tone?: 'primary' | 'danger' | 'warning' | 'highlight';
      label?: string;
      detail?: string;
      ms?: number;
    },
  ): void;
  /**
   * A tile in the Actions menu. `hotkey` is one character, shown on the tile
   * and bound while no field has focus; `icon` names one of the engine's
   * pictures (an unknown name shows the label's first letter). `order` places
   * the tile: lower comes first, and the engine's own menu runs from what is
   * the player's (Inventory 10, Attributes 20, Spells 30, Quests 40) through
   * what is done with others (Party 50, Guild 60, Trade 70, Mail 80, Social
   * 90) to the records (Achievements 100, Leaderboard 110, Online players
   * 120). A tile with no order goes after all of them, in module load order.
   *
   * @example ui.actionButton('Guild', toggle, 'g', 'guild', 60)
   */
  actionButton(
    label: string,
    onClick: () => void,
    hotkey?: string,
    icon?: ActionIcon,
    order?: number,
  ): void;
  /**
   * This module's slots on the bar along the bottom of the world, replacing
   * the ones it set before (`[]` takes them off). A slot's `key` is shown on
   * it and bound while no field has focus; a click, a tap or the key calls
   * `onUse`, which decides whether anything happens.
   *
   * @example ui.hotbar([{ id: 'blast', name: 'Blast', key: 'F1', icon: 148, cost: 30, onUse: cast }])
   */
  hotbar(slots: HotbarSlot[]): void;
  /** A spell's picture: a tile of the spell sheet, or `name`'s initial. */
  SpellIcon: (props: { icon?: number; name: string }) => React.ReactElement;
  /**
   * A character's sprite standing still, with no frame: put it in a box of the
   * module's own. `size` is its side in pixels (64 without it).
   *
   * @example <span className="dialog-portrait"><ui.Sprite spriteId={npc.sprite} /></span>
   */
  Sprite: (props: { spriteId: number; size?: number }) => React.ReactElement;
  /**
   * An item in a 64px box the player can pick, as the inventory draws it: the
   * quantity in the corner, what the item is on hover and on focus. `note` is
   * said after the name ("on offer").
   *
   * @example <ui.ItemSlot item={item} quantity={3} selected={picked === item.id} onSelect={() => pick(item.id)} />
   */
  ItemSlot: (props: {
    item: ItemLook;
    quantity?: number;
    selected: boolean;
    note?: string;
    onSelect(): void;
  }) => React.ReactElement;
  /** An item's picture alone; `size` is its side in pixels (64 without it). */
  ItemIcon: (props: { spriteId: number; size?: number }) => React.ReactElement;
  /**
   * How many, from 1 to `max`, with − and + and Max buttons. `label` names it
   * for a screen reader.
   */
  Stepper: (props: {
    value: number;
    max: number;
    onChange(value: number): void;
    label: string;
  }) => React.ReactElement;
  /** What an empty list shows: what is missing and how to get one. */
  EmptyState: (props: {
    icon: ActionIcon;
    title: string;
    hint: string;
  }) => React.ReactElement;
  /**
   * The window of `panel()` for a module drawn with `engine.render`: open
   * while rendered, so the module keeps whether it is open and renders it or
   * not. Translate the title with `engine.useT()`.
   *
   * @example open && <engine.ui.Window title={t('Guild')} onClose={close}>…</engine.ui.Window>
   */
  Window: (props: {
    title: string;
    /**
     * `'narrow'` (280px), `'regular'` (380) or `'wide'` (560): the sizes of a
     * window the player uses, which also takes the engine's window look. A
     * number is a width in pixels for a tool of your own; without either the
     * window fits what it holds.
     */
    width?: 'narrow' | 'regular' | 'wide' | number;
    /** Beside the title, for what the window holds (`'14/24'`). */
    counter?: string;
    /** The side a window with a width name opens on; left by default. */
    anchor?: 'left' | 'right';
    /** Under the body, out of its scroll: the window's actions. */
    footer?: React.ReactNode;
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

/** The player this client is, with the items spelled out. */
type LocalPlayer = Omit<PlayerServer, 'inventory' | 'equipped'> & {
  inventory: { item: ItemData; quantity: number }[];
  /** How many different items the bag holds. */
  inventoryCapacity: number;
  equipped: Partial<Record<keyof PlayerServer['equipped'], ItemData>>;
};

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
  /**
   * Current local player state (position, health, stats). The bag and what is
   * worn come as the items themselves, not as ids.
   */
  getPlayer(): LocalPlayer | null;
  /**
   * `getPlayer` as a hook, for a window that shows the bag or the stats: the
   * component re-renders while it is mounted, because the player changes
   * without a module being told (a pickup, a potion drunk).
   */
  usePlayer(): LocalPlayer | null;
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
  /** Logical view size, independent of the canvas's device pixel buffer. */
  GAME_WIDTH: number;
  GAME_HEIGHT: number;
  /**
   * Visible rectangle in logical view pixels, after layout cropping, and the
   * CSS pixels one view pixel is shown at (`scale`): what keeps a corner
   * widget the same size on screen however large the world is drawn.
   */
  getVisibleView(): {
    x: number;
    y: number;
    width: number;
    height: number;
    scale: number;
  };
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
  /**
   * Text an overlay writes in the world, at a size a phone can read. The
   * world is drawn 1280 wide on any screen, so `12px` is 4 on a phone; inside
   * `draw` the context is scaled up (twice at most) around (x, y), the point
   * the label hangs from, which is how the engine's own names and damage
   * numbers are drawn.
   *
   * @example
   * engine.registerOverlay((ctx) => {
   *   engine.worldText(ctx, x, y, () => ctx.fillText('Boss', x, y));
   * });
   */
  worldText(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    draw: () => void,
  ): void;
};
