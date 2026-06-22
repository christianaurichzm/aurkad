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

export const renderHUD = (player: Player | PlayerPublic) => {
  const { name, level, position, access, nameColor, nameTag } = player;
  const { x, y } = position;
  const text = getPlayerHudText(name, level);
  const cx = x + TILE_SIZE / 2; // sprite center: names are centered over it

  playerCtx.strokeStyle = 'black';
  playerCtx.textAlign = 'center';

  if (nameTag) {
    playerCtx.font = 'bold 11px Arial';
    playerCtx.fillStyle = '#ffd24d';
    playerCtx.strokeText(nameTag, cx, y - 15);
    playerCtx.fillText(nameTag, cx, y - 15);
  }

  playerCtx.font = 'bold 14px Arial';
  playerCtx.fillStyle = nameColor ?? playerNameColorRecord[access];

  playerCtx.strokeText(text, cx, y);
  playerCtx.fillText(text, cx, y);

  playerCtx.textAlign = 'left';

  renderSpeechBubble(playerCtx, name, cx, y - 2);
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

// The npc's name above its sprite, tinted by behavior and smaller than
// player names, above the health bar for npcs that have one (aggressive),
// otherwise at the sprite top.
export const renderNpcLabel = (npc: RuntimeNpc, hasHealthBar: boolean) => {
  if (!npc.name) return;
  const cx = npc.position.x + TILE_SIZE / 2; // centered over the sprite
  const y = hasHealthBar ? npc.position.y - 18 : npc.position.y;

  playerCtx.font = 'bold 11px Arial';
  playerCtx.fillStyle = npcBehaviorColorRecord[npc.behavior] ?? '#e5e7eb';
  playerCtx.strokeStyle = 'black';
  playerCtx.textAlign = 'center';
  playerCtx.strokeText(npc.name, cx, y);
  playerCtx.fillText(npc.name, cx, y);
  playerCtx.textAlign = 'left';
};

export const renderHealthBar = (npc: RuntimeNpc) => {
  const barWidth = npc.width;
  const barHeight = 10;
  const barX = npc.position.x;
  const barY = npc.position.y - barHeight - 5;

  const { percentage, color } = getHealthBarInfo(npc.health, npc.maxHealth);

  playerCtx.fillStyle = color;
  playerCtx.fillRect(barX, barY, barWidth * percentage, barHeight);

  playerCtx.strokeStyle = 'black';
  playerCtx.strokeRect(barX, barY, barWidth, barHeight);
};

export function showConnectionStatus(message: string, isError = false) {
  useUIStore.getState().showConnectionStatus(message, isError);
}

export function hideConnectionStatus() {
  useUIStore.getState().hideConnectionStatus();
}
