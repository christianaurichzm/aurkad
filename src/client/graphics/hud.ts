import { RuntimeNpc, Player, PlayerPublic } from '../../shared/types';
import { TILE_SIZE } from '../../shared/constants';
import { playerCtx } from './canvas';
import {
  playerNameColorRecord,
  npcBehaviorColorRecord,
} from '../../shared/mappings';
import { useUIStore } from '../stores/uiStore';
import { renderSpeechBubble } from './speechBubble';

export const getPlayerHudText = (name: string, level: number) =>
  `${name} (${level})`;

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
    ctx.shadowBlur = 5;
    // One pass at this radius is a wash. Stacking them is what thickens the
    // halo into something a black glyph reads against.
    ctx.fillText(text, x, y);
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
  const { name, level, position, access, nameColor, nameTag } = player;
  const { x, y } = position;
  const cx = x + TILE_SIZE / 2; // sprite center: names are centered over it

  if (nameTag) {
    outlinedText(ctx, nameTag, cx, y - 15, 'bold 11px Arial', '#ffd24d');
  }
  outlinedText(
    ctx,
    getPlayerHudText(name, level),
    cx,
    y,
    'bold 14px Arial',
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
// than player names, above the health bar for npcs that have one
// (aggressive), otherwise at the sprite top.
export const renderNpcLabel = (
  npc: RuntimeNpc,
  hasHealthBar: boolean,
  ctx: CanvasRenderingContext2D = playerCtx,
) => {
  if (!npc.name) return;
  const cx = npc.position.x + TILE_SIZE / 2; // centered over the sprite
  const y = hasHealthBar ? npc.position.y - 18 : npc.position.y;

  outlinedText(
    ctx,
    npc.name,
    cx,
    y,
    'bold 13px Arial',
    npcBehaviorColorRecord[npc.behavior] ?? '#e5e7eb',
  );
};

export const renderHealthBar = (
  npc: RuntimeNpc,
  ctx: CanvasRenderingContext2D = playerCtx,
) => {
  const barWidth = npc.width;
  const barHeight = 10;
  const barX = npc.position.x;
  const barY = npc.position.y - barHeight - 5;

  const { percentage, color } = getHealthBarInfo(npc.health, npc.maxHealth);

  ctx.fillStyle = color;
  ctx.fillRect(barX, barY, barWidth * percentage, barHeight);

  ctx.strokeStyle = 'black';
  ctx.strokeRect(barX, barY, barWidth, barHeight);
};

export function showConnectionStatus(message: string, isError = false) {
  useUIStore.getState().showConnectionStatus(message, isError);
}

export function hideConnectionStatus() {
  useUIStore.getState().hideConnectionStatus();
}
