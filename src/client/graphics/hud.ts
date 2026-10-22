import {
  RuntimeNpc,
  Player,
  PlayerPublic,
  DroppedItem,
  Key,
  NpcBehavior,
  Access,
} from '../../shared/types';
import { TILE_SIZE } from '../../shared/constants';
import { canInteract } from '../../shared/utils';
import { t } from '../i18n';
import { themeToken } from './floatingText';
import { spritePosition } from './camera';
import { spriteTop } from './spriteDrawing';
import { playerCtx, worldText } from './canvas';
import {
  playerNameColorRecord,
  npcBehaviorColorRecord,
} from '../../shared/mappings';
import { useUIStore } from '../stores/uiStore';
import { renderSpeechBubble } from './speechBubble';
import { getGameBrand } from '../io/network/http/authClient';

// Fonts and colours come from the theme, whose stylesheet blocks rendering,
// so they are read once on first use.
const readTheme = () => ({
  world: themeToken('--font-world', 'monospace'),
  muted: themeToken('--color-text-muted', '#94a3b0'),
  danger: themeToken('--color-danger', '#cf4555'),
  dangerTrack: themeToken('--color-danger-muted', '#2e1d22'),
  surface: themeToken('--color-surface-muted', '#141a20'),
  border: themeToken('--color-border', '#34424f'),
  text: themeToken('--color-text', '#e8eef4'),
  accent: themeToken('--color-accent', '#4ea8de'),
  appBg: themeToken('--color-app-bg', '#0c1014'),
  // The names over the world: a player's by access, an NPC's by behavior
  // (--color-name-admin, --color-name-friendly, ...), and the tag under one.
  playerNames: {
    [Access.USER]: themeToken(
      '--color-name-user',
      playerNameColorRecord[Access.USER],
    ),
    [Access.MOD]: themeToken(
      '--color-name-mod',
      playerNameColorRecord[Access.MOD],
    ),
    [Access.ADMIN]: themeToken(
      '--color-name-admin',
      playerNameColorRecord[Access.ADMIN],
    ),
  },
  npcNames: Object.fromEntries(
    Object.entries(npcBehaviorColorRecord).map(([behavior, color]) => [
      behavior,
      themeToken(`--color-name-${behavior}`, color),
    ]),
  ) as Record<NpcBehavior, string>,
  nameTag: themeToken('--color-name-tag', '#ffd24d'),
});
let theme: ReturnType<typeof readTheme> | null = null;
const hudTheme = () => (theme ??= readTheme());

// A game with no levels shows none; until /game has answered, assume it has.
export const getPlayerHudText = (name: string, level: number, levels = true) =>
  levels ? `${name} (${level})` : name;

// Reading a canvas colour back normalises it, which is all the parsing this
// needs; anything but a plain hex counts as light.
const isDarkFill = (fill: unknown): boolean => {
  const hex = /^#([0-9a-f]{6})$/i.exec(String(fill))?.[1];
  if (!hex) return false;
  const n = parseInt(hex, 16);
  const luma =
    0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return luma < 110;
};

// Names are lifted off whatever is behind them: a light name gets a black
// outline with round joins, a dark one a light halo. Both are undone after,
// since the same context draws the health bar and sprites next.
const outlinedText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  color: string,
) => {
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.fillStyle = color;

  if (isDarkFill(ctx.fillStyle)) {
    ctx.shadowColor = 'rgba(255, 255, 255, 0.85)';
    ctx.shadowBlur = 3;
    // Two passes make a halo a black glyph reads against; more becomes a plate.
    ctx.fillText(text, x, y);
    ctx.fillText(text, x, y);
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
  } else {
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
    ctx.lineWidth = 1;
    ctx.lineJoin = 'miter';
  }

  ctx.textAlign = 'left';
};

export const renderHUD = (
  player: Player | PlayerPublic,
  ctx: CanvasRenderingContext2D = playerCtx,
) => {
  const { name, level, position, access, nameColor, nameTag, nameTagColor } =
    player;
  const { x } = spritePosition(position.x, position.y);
  const y = spriteTop(player.sprite, position.x, position.y) - NAME_CLEARANCE;
  const cx = x + TILE_SIZE / 2; // sprite center: names are centered over it
  const { world, playerNames, nameTag: tagColor } = hudTheme();
  // A tag sits under the name, as an NPC's role does (renderNpcLabel).
  const nameY = nameTag ? y - 14 : y;

  worldText(ctx, cx, y, () => {
    if (nameTag) {
      outlinedText(
        ctx,
        nameTag,
        cx,
        y,
        `bold 12px ${world}`,
        nameTagColor ?? tagColor,
      );
    }
    outlinedText(
      ctx,
      getPlayerHudText(name, level, getGameBrand()?.levels !== false),
      cx,
      nameY,
      `bold 15px ${world}`,
      nameColor ?? playerNames[access],
    );

    renderSpeechBubble(ctx, name, cx, nameY - 2);
  });
};

export function getHealthBarInfo(current: number, max: number) {
  const percentage = Math.max(0, Math.min(current / max, 1));
  let color = 'green';

  if (percentage <= 0.5 && percentage > 0.2) {
    color = 'yellow';
  } else if (percentage <= 0.2) {
    color = 'red';
  }

  return {
    percentage,
    color,
    text: `${Math.round(percentage * 100)}%`,
  };
}

export const updatePlayerHealthBar = (player: Player) => {
  const ui = useUIStore.getState();
  ui.setPlayerHealth(player.health, player.maxHealth, player.level);
  ui.setPlayerXp(player.experience, player.experienceToNextLevel);
};

// The npc's name above its sprite, tinted by behavior and a shade smaller
// than player names. "Thomas, merchant" draws the title smaller and muted
// under the name, above the health bar when there is one.
export const renderNpcLabel = (
  npc: RuntimeNpc,
  hasHealthBar: boolean,
  ctx: CanvasRenderingContext2D = playerCtx,
) => {
  if (!npc.name) return;
  const { world, muted, npcNames } = hudTheme();
  const at = spritePosition(npc.position.x, npc.position.y);
  const cx = at.x + npc.width / 2; // centered over the sprite
  const top = spriteTop(
    npc.sprite,
    npc.position.x,
    npc.position.y,
    npc.width,
    npc.height,
  );
  const y = top - (hasHealthBar ? HEALTH_BAR_CLEARANCE : NAME_CLEARANCE);
  const comma = npc.name.indexOf(',');
  const role = comma > 0 ? npc.name.slice(comma + 1).trim() : '';

  worldText(ctx, cx, y, () => {
    if (role) outlinedText(ctx, role, cx, y, `bold 12px ${world}`, muted);
    outlinedText(
      ctx,
      role ? npc.name.slice(0, comma) : npc.name,
      cx,
      role ? y - 14 : y,
      `bold 14px ${world}`,
      npcNames[npc.behavior] ?? npcNames.neutral,
    );
  });
};

const HEALTH_BAR_HEIGHT = 5;
// Room above the head for the bar, its outline and a name's descenders.
const HEALTH_BAR_CLEARANCE = HEALTH_BAR_HEIGHT + 8;
// Room between a head and the name's baseline: the descenders, the outline
// round them, and air enough that the name does not read as part of the hair.
const NAME_CLEARANCE = 6;

// A slim bar in the danger colour: the colour says whose health it is, the
// length how much is left.
export const renderHealthBar = (
  npc: RuntimeNpc,
  ctx: CanvasRenderingContext2D = playerCtx,
) => {
  const { danger, dangerTrack } = hudTheme();
  const width = npc.width;
  const height = HEALTH_BAR_HEIGHT;
  const at = spritePosition(npc.position.x, npc.position.y);
  const x = at.x;
  const top = spriteTop(
    npc.sprite,
    npc.position.x,
    npc.position.y,
    npc.width,
    npc.height,
  );
  const y = top - height - 4;
  const { percentage } = getHealthBarInfo(npc.health, npc.maxHealth);

  ctx.fillStyle = 'black';
  ctx.fillRect(x - 1, y - 1, width + 2, height + 2);
  ctx.fillStyle = dangerTrack;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = danger;
  ctx.fillRect(x, y, Math.round(width * percentage), height);
};

export function showConnectionStatus(message: string, isError = false) {
  useUIStore.getState().showConnectionStatus(message, isError);
}

export function hideConnectionStatus() {
  useUIStore.getState().hideConnectionStatus();
}

export interface InteractPrompt {
  key: Key.e | Key.f;
  text: string;
}

// A fighting npc offers interaction only with dialog content, since its
// scriptId may serve its death; others always do, since a script can
// answer npcInteract by name.
const FIGHTERS = new Set<NpcBehavior>(['aggressive', 'hostile']);

/**
 * What the pick-up or interact key would do where the player stands: a drop on
 * their tile first (the key takes the last one dropped there), else the npc
 * they face, by the same reach the server applies to the press.
 */
export function findInteractPrompt(
  player: Player,
  map: { droppedItems: DroppedItem[]; npcs: Record<string, RuntimeNpc> },
): InteractPrompt | null {
  const { x, y } = player.position;
  const drop = map.droppedItems.findLast(
    (d) => d.position.x === x && d.position.y === y,
  );
  if (drop) {
    const item =
      drop.name && drop.quantity > 1
        ? `${drop.name} x${drop.quantity}`
        : (drop.name ?? '');
    return { key: Key.e, text: t('prompt.pickUp', { item }).trim() };
  }
  for (const npc of Object.values(map.npcs)) {
    if (!canInteract(player, npc)) continue;
    const { name } = npc;
    if (npc.dialogId || npc.questId)
      return { key: Key.f, text: t('prompt.talk', { name }) };
    if (FIGHTERS.has(npc.behavior)) continue;
    return {
      key: Key.f,
      text: t(npc.scriptId ? 'prompt.use' : 'prompt.talk', { name }),
    };
  }
  return null;
}

// A touch screen has no E or F to press: there the prompt is the words alone,
// and the pad lights the button that does it.
const coarsePointer =
  typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;

/** The prompt as a plate centred on `cx`, its top edge at `top`. */
export function renderInteractPrompt(
  ctx: CanvasRenderingContext2D,
  prompt: InteractPrompt,
  cx: number,
  top: number,
) {
  worldText(ctx, cx, top, () => drawInteractPrompt(ctx, prompt, cx, top));
}

function drawInteractPrompt(
  ctx: CanvasRenderingContext2D,
  prompt: InteractPrompt,
  cx: number,
  top: number,
) {
  const s = hudTheme();
  const key = coarsePointer?.matches ? '' : prompt.key.toUpperCase();
  ctx.font = `13px ${s.world}`;
  ctx.textBaseline = 'middle';
  const pad = 7;
  const height = 22;
  const chip = key ? ctx.measureText(key).width + 10 : 0;
  const gap = key ? 6 : 0;
  const width = Math.round(
    pad * 2 + chip + gap + ctx.measureText(prompt.text).width,
  );
  const left = Math.round(cx - width / 2);
  const mid = top + height / 2;

  ctx.fillStyle = s.border;
  ctx.fillRect(left, top, width, height);
  ctx.fillStyle = s.surface;
  ctx.fillRect(left + 2, top + 2, width - 4, height - 4);
  if (key) {
    ctx.fillStyle = s.accent;
    ctx.fillRect(left + pad, top + 4, chip, height - 8);
    ctx.fillStyle = s.appBg;
    ctx.textAlign = 'center';
    ctx.fillText(key, left + pad + chip / 2, mid + 1);
  }
  ctx.fillStyle = s.text;
  ctx.textAlign = 'left';
  ctx.fillText(prompt.text, left + pad + chip + gap, mid + 1);
  ctx.textBaseline = 'alphabetic';
}
