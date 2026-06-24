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
import { renderHUD, renderHealthBar, renderNpcLabel } from './hud';
import { itemCtx } from './canvas';
import { getAnimatedState } from './movementAnimation';

type AnimatableEntity = {
  id: string;
  position: Position;
  direction: Direction;
  action: CharacterAction;
};

const slideTById = new Map<string, number>();

// Force Walk action while sliding even if the server already reports Idle.
export function animate<T extends AnimatableEntity>(entity: T): T {
  const anim = getAnimatedState(entity.id, entity.position);
  const action =
    anim.moving && entity.action === CharacterAction.Idle
      ? CharacterAction.Walk
      : entity.action;
  slideTById.set(entity.id, anim.slideT);
  return { ...entity, position: anim.position, action };
}

const WALK_CYCLE_LENGTH = 4;

const animationColumn = (id: string, action: CharacterAction): number => {
  if (action !== CharacterAction.Walk && action !== CharacterAction.Run) {
    slideTById.delete(id);
    return playerActionToActionColumnRecord[action];
  }
  const slideT = slideTById.get(id) ?? 0;
  return Math.floor(slideT * WALK_CYCLE_LENGTH) % WALK_CYCLE_LENGTH;
};

const renderEntity = (entity: {
  id: string;
  position: Position;
  direction: Direction;
  sprite: number;
  action: CharacterAction;
}) => {
  drawSprite(
    entity.sprite,
    animationColumn(entity.id, entity.action),
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
      const hasHealthBar = npc.behavior === 'aggressive';
      if (hasHealthBar) {
        renderHealthBar(smoothed);
      }
      renderNpcLabel(smoothed, hasHealthBar);
    }
  });
};

export const renderDroppedItems = (droppedItems: DroppedItem[]) => {
  droppedItems.forEach((item) => {
    renderItemIcon(itemCtx, item.sprite, item.position.x, item.position.y);
  });
};

export const renderEntityDirect = renderEntity;
