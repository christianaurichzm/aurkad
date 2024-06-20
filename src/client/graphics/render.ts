import { ctx, canvas } from './canvas';
import { Enemy, PlayersMap } from '../../shared/types';
import { renderHUD, renderHealthBar } from '../ui/hud';

const renderEntity = (entity: {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}) => {
  ctx.fillStyle = entity.color;
  ctx.fillRect(entity.x, entity.y, entity.width, entity.height);
};

const renderPlayers = (players: PlayersMap) => {
  Object.values(players).forEach((player) => {
    renderEntity(player);
    renderHUD(player);
  });
};

const renderEnemies = (enemies: Enemy[]) => {
  Object.values(enemies).forEach((enemy) => {
    if (enemy.health > 0) {
      renderEntity(enemy);
      renderHealthBar(enemy);
    }
  });
};

export const render = (players: PlayersMap, enemies: Enemy[]) => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  renderPlayers(players);
  renderEnemies(enemies);
};
