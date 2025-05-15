import { TILE_SIZE } from '../../shared/constants';
import {
  PlayerAction,
  Direction,
  PlayersMap,
  Position,
  playerActionRecord,
  NpcsMap,
  DroppedItem,
} from '../../shared/types';
import { getGameState, getPlayer } from '../core/gameState';
import { spriteSheet } from '../io/files';
import { renderHealthBar, renderHUD, updatePlayerHealthBar } from '../ui/hud';
import { foregroundCanvas, foregroundCtx, itemCtx, playerCtx } from './canvas';
import { renderItemIcon } from './inventory';
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

const renderNpcs = (npcs: NpcsMap) => {
  Object.values(npcs).forEach((npc) => {
    if (npc.health > 0) {
      renderEntity(npc);
      renderHealthBar(npc);
    }
  });
};

const renderDroppedItems = (droppedItems: DroppedItem[]) => {
  droppedItems.forEach((item) => {
    renderItemIcon(itemCtx, item.sprite, item.position.x, item.position.y);
  });
};

export function drawSprite(
  characterIndex: number,
  column: number,
  row: number,
  posX: number,
  posY: number,
) {
  const { x, y } = getCharacterSpriteCoordinates(
    characterIndex,
    column,
    row,
    spriteSheet.naturalWidth,
  );
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

export const render = () => {
  const map = getGameState();

  if (map) {
    const mapName = document.getElementById('mapName') as HTMLElement;
    mapName.textContent = `${map.id} - ${map.name}`;

    if (map.type === 'pvp' && mapName.style.color !== 'red') {
      mapName.style.color = 'red';
    }

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
    renderDroppedItems(map.droppedItems);
    renderPlayers(map.players);
    renderNpcs(map.npcs);
    updatePlayerHealthBar(getPlayer().health);
  }
};
