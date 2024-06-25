import { Enemy, Player } from '../../shared/types';
import { foregroundCtx } from '../graphics/canvas';

export const renderHUD = (player: Player) => {
  foregroundCtx.fillStyle = 'black';
  foregroundCtx.font = '14px Arial';
  foregroundCtx.fillText(
    `${player.name} - Level: ${player.level}`,
    player.position.x,
    player.position.y - 10,
  );
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

  foregroundCtx.fillStyle = barColor;
  foregroundCtx.fillRect(barX, barY, barWidth * healthPercentage, barHeight);

  foregroundCtx.strokeStyle = 'black';
  foregroundCtx.strokeRect(barX, barY, barWidth, barHeight);
};
