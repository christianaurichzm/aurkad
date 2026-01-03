import { RuntimeNpc, Player, PlayerPublic } from '../../shared/types';
import { playerCtx } from './canvas';
import { playerNameColorRecord } from '../../shared/mappings';
import { useUIStore } from '../stores/uiStore';

export const renderHUD = (player: Player | PlayerPublic) => {
  const { name, level, position, access } = player;
  const { x, y } = position;
  const text = `${name} - Level: ${level}`;

  playerCtx.font = 'bold 14px Arial';
  playerCtx.strokeStyle = 'black';
  playerCtx.fillStyle = playerNameColorRecord[access];

  playerCtx.strokeText(text, x, y);
  playerCtx.fillText(text, x, y);
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
  useUIStore.getState().setPlayerHealth(player.health, player.maxHealth);
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
