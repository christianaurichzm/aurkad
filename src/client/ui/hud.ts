import { Enemy, Player } from '../../shared/types';
import { playerCtx } from '../graphics/canvas';

export const renderHUD = (player: Player) => {
  playerCtx.fillStyle = 'black';
  playerCtx.font = '14px Arial';
  playerCtx.fillText(
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

  playerCtx.fillStyle = barColor;
  playerCtx.fillRect(barX, barY, barWidth * healthPercentage, barHeight);

  playerCtx.strokeStyle = 'black';
  playerCtx.strokeRect(barX, barY, barWidth, barHeight);
};
