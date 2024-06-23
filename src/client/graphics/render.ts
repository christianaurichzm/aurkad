import { Enemy, GameMap, PlayersMap } from '../../shared/types';
import { renderHealthBar, renderHUD } from '../ui/hud';
import { canvas, ctx } from './canvas';

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

const renderEnemies = (enemies: { [key: string]: Enemy }) => {
  Object.values(enemies).forEach((enemy) => {
    if (enemy?.health > 0) {
      renderEntity(enemy);
      renderHealthBar(enemy);
    }
  });
};

export const render = (map?: GameMap) => {
  if (map) {
    ctx.fillStyle = map.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    renderPlayers(map.players);
    renderEnemies(map.enemies);
  }
};
