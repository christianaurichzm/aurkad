import { ctx } from '../graphics/canvas';
import { Player } from '../../shared/types';

export function renderHUD(player: Player) {
  ctx.fillStyle = 'black';
  ctx.font = '14px Arial';
  ctx.fillText(
    `${player.id} - Level: ${player.level}`,
    player.x,
    player.y - 10,
  );
}
