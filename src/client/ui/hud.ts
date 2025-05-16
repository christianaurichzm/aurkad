import { Npc, Player, playerNameColorRecord } from '../../shared/types';
import { playerCtx } from '../graphics/canvas';

export const renderHUD = (player: Player) => {
  const { name, level, position, access } = player;
  const { x, y } = position;
  const text = `${name} - Level: ${level}`;

  playerCtx.font = 'bold 14px Arial';
  playerCtx.strokeStyle = 'black';
  playerCtx.fillStyle = playerNameColorRecord[access];

  playerCtx.strokeText(text, x, y);
  playerCtx.fillText(text, x, y);
};

function getHealthBarInfo(current: number, max: number) {
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
  const healthBar = document.getElementById('health-bar');
  const healthBarText = document.getElementById('health-bar-text');

  if (!healthBar || !healthBarText) return;

  const { color, text } = getHealthBarInfo(player.health, player.maxHealth);

  healthBar.style.width = text;
  healthBarText.textContent = text;
  healthBar.style.backgroundColor = color;
};

export const renderHealthBar = (npc: Npc) => {
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
  const element = document.getElementById('connection-status');
  if (!element) return;

  element.textContent = message;
  element.style.background = isError ? '#c0392b' : '#27ae60';
  element.style.display = 'block';
}

export function hideConnectionStatus() {
  const element = document.getElementById('connection-status');
  if (!element) return;
  element.style.display = 'none';
}
