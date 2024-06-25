import { EnemiesMap, MapState, PlayersMap, Position } from '../../shared/types';
import { renderHealthBar, renderHUD } from '../ui/hud';
import { foregroundCanvas, foregroundCtx } from './canvas';

const renderEntity = (entity: {
  position: Position;
  width: number;
  height: number;
  color: string;
}) => {
  foregroundCtx.fillStyle = entity.color;
  foregroundCtx.fillRect(
    entity.position.x,
    entity.position.y,
    entity.width,
    entity.height,
  );
};

const renderPlayers = (players: PlayersMap) => {
  Object.values(players).forEach((player) => {
    renderEntity(player);
    renderHUD(player);
  });
};

const renderEnemies = (enemies: EnemiesMap) => {
  Object.values(enemies).forEach((enemy) => {
    if (enemy?.health > 0) {
      renderEntity(enemy);
      renderHealthBar(enemy);
    }
  });
};

export const render = (map?: MapState) => {
  if (map) {
    foregroundCtx.clearRect(
      0,
      0,
      foregroundCanvas.width,
      foregroundCanvas.height,
    );
    renderPlayers(map.players);
    renderEnemies(map.enemies);
  }
};
