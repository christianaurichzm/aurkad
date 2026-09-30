import { RuntimeNpc, Player, PlayerPublic } from '../../shared/types';
import { TILE_SIZE } from '../../shared/constants';
import { themeToken } from './floatingText';
import { playerCtx } from './canvas';
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
  const { x, y } = position;
  const cx = x + TILE_SIZE / 2; // sprite center: names are centered over it
  const { world } = hudTheme();

  if (nameTag) {
    outlinedText(
      ctx,
      nameTag,
      cx,
      y - 16,
      `bold 12px ${world}`,
      nameTagColor ?? '#ffd24d',
    );
  }
  outlinedText(
    ctx,
    getPlayerHudText(name, level, getGameBrand()?.levels !== false),
    cx,
    y,
    `bold 15px ${world}`,
    nameColor ?? playerNameColorRecord[access],
  );

  renderSpeechBubble(ctx, name, cx, y - 2);
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
  const { world, muted } = hudTheme();
  const cx = npc.position.x + TILE_SIZE / 2; // centered over the sprite
  let y = hasHealthBar ? npc.position.y - HEALTH_BAR_CLEARANCE : npc.position.y;
  const comma = npc.name.indexOf(',');
  const role = comma > 0 ? npc.name.slice(comma + 1).trim() : '';
  if (role) {
    outlinedText(ctx, role, cx, y, `bold 12px ${world}`, muted);
    y -= 14;
  }

  outlinedText(
    ctx,
    role ? npc.name.slice(0, comma) : npc.name,
    cx,
    y,
    `bold 14px ${world}`,
    npcBehaviorColorRecord[npc.behavior] ?? '#e5e7eb',
  );
};

const HEALTH_BAR_HEIGHT = 5;
// Room above the sprite for the bar, its outline and a name's descenders.
const HEALTH_BAR_CLEARANCE = HEALTH_BAR_HEIGHT + 8;

// A slim bar in the danger colour: the colour says whose health it is, the
// length how much is left.
export const renderHealthBar = (
  npc: RuntimeNpc,
  ctx: CanvasRenderingContext2D = playerCtx,
) => {
  const { danger, dangerTrack } = hudTheme();
  const width = npc.width;
  const height = HEALTH_BAR_HEIGHT;
  const x = npc.position.x;
  const y = npc.position.y - height - 4;
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
