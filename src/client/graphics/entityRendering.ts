import {
  CharacterAction,
  Direction,
  DroppedItem,
  PlayersMap,
  Position,
  RuntimeNpcsMap,
} from '../../shared/types';
import {
  MOVEMENT_DURATION,
  RUN_MOVEMENT_DURATION,
} from '../../shared/constants';
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

// The 4 sprite columns are a sequential walk cycle. Cycle through them while
// moving (two frames per tile) so legs animate; the per-frame interval tracks
// the move speed so running steps faster. Idle/Attack keep their fixed column.
const WALK_CYCLE = [0, 1, 2, 3];

const animationColumn = (action: CharacterAction): number => {
  if (action !== CharacterAction.Walk && action !== CharacterAction.Run) {
    return playerActionToActionColumnRecord[action];
  }
  const tileDuration =
    action === CharacterAction.Run ? RUN_MOVEMENT_DURATION : MOVEMENT_DURATION;
  const frameMs = tileDuration / 2;
  const frame = Math.floor(performance.now() / frameMs) % WALK_CYCLE.length;
  return WALK_CYCLE[frame];
};

const renderEntity = (entity: {
  position: Position;
  direction: Direction;
  sprite: number;
  action: CharacterAction;
}) => {
  drawSprite(
    entity.sprite,
    animationColumn(entity.action),
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
