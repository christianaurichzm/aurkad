import { ctx, canvas } from './canvas';
import { Player, Enemy } from '../../shared/types';
import { renderHUD } from '../ui/hud';
import { getPlayer } from '../core/player';

export function render(players: { [key: string]: Player }, enemies: Enemy[]) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const player = players[getPlayer()?.id];

  if (player) {
    ctx.fillStyle = player.color;
    ctx.fillRect(player.x, player.y, player.width, player.height);
    renderHUD(player);
  }

  for (const id in players) {
    const otherPlayer = players[id];
    ctx.fillStyle = otherPlayer.color;
    ctx.fillRect(
      otherPlayer.x,
      otherPlayer.y,
      otherPlayer.width,
      otherPlayer.height,
    );
    ctx.fillStyle = 'black';
    ctx.font = '14px Arial';
    ctx.fillText(
      `${otherPlayer.id} - Level: ${otherPlayer.level}`,
      otherPlayer.x,
      otherPlayer.y - 10,
    );
  }

  enemies.forEach((enemy) => {
    if (enemy.health > 0) {
      ctx.fillStyle = enemy.color;
      ctx.fillRect(enemy.x, enemy.y, enemy.width, enemy.height);
      renderHealthBar(enemy);
    }
  });
}

function renderHealthBar(enemy: Enemy) {
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
}
