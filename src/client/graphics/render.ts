import {
  PlayerAction,
  Direction,
  EnemiesMap,
  MapState,
  PlayersMap,
  Position,
} from '../../shared/types';
import { spriteSheet } from '../io/files';
import { renderHealthBar, renderHUD } from '../ui/hud';
import { foregroundCanvas, playerCtx } from './canvas';
import { getCharacterSpriteCoordinates, getSpriteSize } from './sprite';

const renderEntity = (entity: {
  position: Position;
  direction: Direction;
  sprite: number;
  action: PlayerAction;
}) => {
  drawSprite(
    entity.sprite,
    entity.action,
    entity.direction,
    entity.position.x,
    entity.position.y,
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

export function drawSprite(
  characterIndex: number,
  column: number,
  row: number,
  posX: number,
  posY: number,
) {
  const { x, y } = getCharacterSpriteCoordinates(characterIndex, column, row);
  const { SPRITE_WIDTH, SPRITE_HEIGHT } = getSpriteSize();

  playerCtx.drawImage(
    spriteSheet,
    x,
    y,
    SPRITE_WIDTH,
    SPRITE_HEIGHT,
    posX,
    posY,
    SPRITE_WIDTH,
    SPRITE_HEIGHT,
  );
}

export const render = (map?: MapState) => {
  if (map) {
    playerCtx.clearRect(0, 0, foregroundCanvas.width, foregroundCanvas.height);
    renderPlayers(map.players);
    renderEnemies(map.enemies);
  }
};
