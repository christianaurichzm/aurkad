import { ctx, canvas } from './canvas';
import { Player, Enemy } from '../../shared/types';
import { renderHUD, renderHealthBar } from '../ui/hud';
import { getPlayer } from '../core/player';

export const render = (
  players: { [key: string]: Player },
  enemies: Enemy[],
) => {
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
    renderHUD(otherPlayer);
  }

  enemies.forEach((enemy) => {
    if (enemy.health > 0) {
      ctx.fillStyle = enemy.color;
      ctx.fillRect(enemy.x, enemy.y, enemy.width, enemy.height);
      renderHealthBar(enemy);
    }
  });
};
