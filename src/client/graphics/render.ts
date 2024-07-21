import { TILE_SIZE } from '../../shared/constants';
import {
  PlayerAction,
  Direction,
  EnemiesMap,
  MapState,
  PlayersMap,
  Position,
  playerActionRecord,
} from '../../shared/types';
import { spriteSheet } from '../io/files';
import { renderHealthBar, renderHUD } from '../ui/hud';
import { foregroundCanvas, foregroundCtx, playerCtx } from './canvas';
import { getCharacterSpriteCoordinates, getSpriteSize } from './sprite';
import { mapEdited, renderMap } from './tileset';

const renderEntity = (entity: {
  position: Position;
  direction: Direction;
  sprite: number;
  action: PlayerAction;
}) => {
  drawSprite(
    entity.sprite,
    playerActionRecord[entity.action],
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

  const offsetX = (TILE_SIZE - SPRITE_WIDTH) / 2;
  const offsetY = (TILE_SIZE - SPRITE_HEIGHT) / 2;

  playerCtx.drawImage(
    spriteSheet,
    x,
    y,
    SPRITE_WIDTH,
    SPRITE_HEIGHT,
    posX + offsetX,
    posY + offsetY,
    SPRITE_WIDTH,
    SPRITE_HEIGHT,
  );
}

export const render = (map?: MapState) => {
  if (map) {
    const mapName = document.getElementById('mapName') as HTMLElement;
    mapName.textContent = `${map.id} - ${map.name}`;
    playerCtx.clearRect(0, 0, foregroundCanvas.width, foregroundCanvas.height);
    if (!mapEdited) {
      foregroundCtx.clearRect(
        0,
        0,
        foregroundCanvas.width,
        foregroundCanvas.height,
      );
      renderMap(map.tiles);
    }
    renderPlayers(map.players);
    renderEnemies(map.enemies);
  }
};
