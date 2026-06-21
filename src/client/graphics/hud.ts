import { RuntimeNpc, Player, PlayerPublic } from '../../shared/types';
import { TILE_SIZE } from '../../shared/constants';
import { playerCtx } from './canvas';
import { playerNameColorRecord } from '../../shared/mappings';
import { useUIStore } from '../stores/uiStore';
import { renderSpeechBubble } from './speechBubble';

export const getPlayerHudText = (name: string, level: number) =>
  `${name} (${level})`;

export const renderHUD = (player: Player | PlayerPublic) => {
  const { name, level, position, access } = player;
  const { x, y } = position;
  const text = getPlayerHudText(name, level);

  playerCtx.font = 'bold 14px Arial';
  playerCtx.strokeStyle = 'black';
  playerCtx.fillStyle = playerNameColorRecord[access];

  playerCtx.strokeText(text, x, y);
  playerCtx.fillText(text, x, y);

  renderSpeechBubble(playerCtx, name, x + TILE_SIZE / 2, y - 2);
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
  useUIStore
    .getState()
    .setPlayerHealth(player.health, player.maxHealth, player.level);
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
