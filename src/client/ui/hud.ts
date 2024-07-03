import { Enemy, Player, playerNameColorRecord } from '../../shared/types';
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
