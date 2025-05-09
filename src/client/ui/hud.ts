import { Enemy, Player, playerNameColorRecord } from '../../shared/types';
import { playerCtx } from '../graphics/canvas';

export const renderHUD = (player: Player) => {
  const { name, level, position, access } = player;
  const { x, y } = position;
  const text = `${name} - Level: ${level}`;

  updatePlayerHealthBar(player.health);

  playerCtx.font = 'bold 14px Arial';
  playerCtx.strokeStyle = 'black';
  playerCtx.fillStyle = playerNameColorRecord[access];

  playerCtx.strokeText(text, x, y);
  playerCtx.fillText(text, x, y);
};

const updatePlayerHealthBar = (health: number) => {
  const healthBar = document.getElementById('health-bar');
  const healthBarText = document.getElementById('health-bar-text');

  if (healthBar && healthBarText) {
    healthBar.style.width = `${health}%`;
    healthBarText.textContent = `${health}%`;

    let barColor = 'green';

    if (health <= 0.5 && health > 0.2) {
      barColor = 'yellow';
    } else if (health <= 0.2) {
      barColor = 'red';
    }

    healthBar.style.backgroundColor = barColor;
  }
};

export const renderHealthBar = (enemy: Enemy) => {
  const barWidth = enemy.width;
  const barHeight = 10;
  const barX = enemy.position.x;
  const barY = enemy.position.y - barHeight - 5;

  const healthPercentage = enemy.health / 100;
  let barColor = 'green';

  if (healthPercentage <= 0.5 && healthPercentage > 0.2) {
    barColor = 'yellow';
  } else if (healthPercentage <= 0.2) {
    barColor = 'red';
  }

  playerCtx.fillStyle = barColor;
  playerCtx.fillRect(barX, barY, barWidth * healthPercentage, barHeight);

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
