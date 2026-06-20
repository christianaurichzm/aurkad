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
import { getAnimatedState } from './movementAnimation';

type AnimatableEntity = {
  id: string;
  position: Position;
  direction: Direction;
  action: CharacterAction;
};

// Apply the interpolated position and force the walking pose while a slide is
// in flight (the server may already report Idle by then). Facing comes straight
// from the authoritative snapshot direction.
export function animate<T extends AnimatableEntity>(entity: T): T {
  const anim = getAnimatedState(entity.id, entity.position);
  const action =
    anim.moving && entity.action === CharacterAction.Idle
      ? CharacterAction.Walk
      : entity.action;
  return { ...entity, position: anim.position, action };
}

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
    const smoothed = animate(player);
    renderEntity(smoothed);
    renderHUD(smoothed);
  });
};

export const renderNpcs = (npcs: RuntimeNpcsMap) => {
  Object.values(npcs).forEach((npc) => {
    if (npc.health > 0) {
      const smoothed = animate(npc);
      renderEntity(smoothed);
      if (npc.behavior === 'aggressive') {
        renderHealthBar(smoothed);
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
