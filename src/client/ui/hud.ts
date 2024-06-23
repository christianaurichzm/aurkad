import { Enemy, Player } from '../../shared/types';
import { ctx } from '../graphics/canvas';

export const renderHUD = (player: Player) => {
  ctx.fillStyle = 'black';
  ctx.font = '14px Arial';
  ctx.fillText(
    `${player.name} - Level: ${player.level}`,
    player.x,
    player.y - 10,
  );
};

export const renderHealthBar = (enemy: Enemy) => {
  const barWidth = enemy.width;
  const barHeight = 10;
  const barX = enemy.x;
  const barY = enemy.y - barHeight - 5;

  const healthPercentage = enemy.health / 100;
  let barColor = 'green';

  if (healthPercentage <= 0.5 && healthPercentage > 0.2) {
    barColor = 'yellow';
  } else if (healthPercentage <= 0.2) {
    barColor = 'red';
  }

  ctx.fillStyle = barColor;
  ctx.fillRect(barX, barY, barWidth * healthPercentage, barHeight);

  ctx.strokeStyle = 'black';
  ctx.strokeRect(barX, barY, barWidth, barHeight);
};
