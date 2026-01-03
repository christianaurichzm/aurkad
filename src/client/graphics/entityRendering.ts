import {
  CharacterAction,
  Direction,
  DroppedItem,
  PlayersMap,
  Position,
  RuntimeNpcsMap,
} from '../../shared/types';
import { playerActionToActionColumnRecord } from '../../shared/mappings';
import { drawSprite } from './spriteDrawing';
import { renderItemIcon } from './itemDrawing';
import { renderHUD, renderHealthBar } from './hud';
import { itemCtx } from './canvas';
import { getAnimatedPosition } from './movementAnimation';

const renderEntity = (entity: {
  position: Position;
  direction: Direction;
  sprite: number;
  action: CharacterAction;
}) => {
  drawSprite(
    entity.sprite,
    playerActionToActionColumnRecord[entity.action],
    entity.direction,
    entity.position.x,
    entity.position.y,
  );
};

export const renderPlayers = (players: PlayersMap) => {
  Object.values(players).forEach((player) => {
    const smoothPosition = getAnimatedPosition(player.id);
    renderEntity({
      ...player,
      position: smoothPosition,
    });
    renderHUD(player);
  });
};

export const renderNpcs = (npcs: RuntimeNpcsMap) => {
  Object.values(npcs).forEach((npc) => {
    if (npc.health > 0) {
      renderEntity(npc);
      if (npc.behavior === 'aggressive') {
        renderHealthBar(npc);
      }
    }
  });
};

export const renderDroppedItems = (droppedItems: DroppedItem[]) => {
  droppedItems.forEach((item) => {
    renderItemIcon(itemCtx, item.sprite, item.position.x, item.position.y);
  });
};

export const renderEntityDirect = renderEntity;
