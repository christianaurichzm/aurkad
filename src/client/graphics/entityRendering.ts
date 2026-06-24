import {
  CharacterAction,
  Direction,
  DroppedItem,
  PlayersMap,
  PlayerPublic,
  Position,
  RuntimeNpc,
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

type SpriteEntity = {
  id: string;
  position: Position;
  direction: Direction;
  sprite: number;
  action: CharacterAction;
};

const slideTById = new Map<string, number>();
const animPosByEntityId = new Map<string, Position>();

// Force Walk action while sliding even if the server already reports Idle.
export function animate<T extends AnimatableEntity>(entity: T): T {
  const anim = getAnimatedState(entity.id, entity.position);
  const action =
    anim.moving && entity.action === CharacterAction.Idle
      ? CharacterAction.Walk
      : entity.action;
  slideTById.set(entity.id, anim.slideT);
  animPosByEntityId.set(entity.id, anim.position);
  return { ...entity, position: anim.position, action };
}

export function getAnimatedPos(entityId: string): Position | undefined {
  return animPosByEntityId.get(entityId);
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

const renderEntity = (entity: SpriteEntity) => {
  drawSprite(
    entity.sprite,
    animationColumn(entity.id, entity.action),
    entity.direction,
    entity.position.x,
    entity.position.y,
  );
};

// Renders all players and NPCs sorted by Y so entities further down the screen
// (visually in front) always draw on top of entities above them. Two-pass:
// sprites first (sorted), HUDs second (always on top regardless of depth).
export function renderEntitiesSorted(
  players: PlayersMap,
  npcs: RuntimeNpcsMap,
): void {
  type PlayerEntry = { kind: 'player'; y: number; entity: PlayerPublic };
  type NpcEntry = {
    kind: 'npc';
    y: number;
    entity: RuntimeNpc;
    hasHealthBar: boolean;
  };
  type Entry = PlayerEntry | NpcEntry;

  const buf: Entry[] = [];

  for (const player of Object.values(players)) {
    const s = animate(player);
    buf.push({ kind: 'player', y: s.position.y, entity: s });
  }
  for (const npc of Object.values(npcs)) {
    if (npc.health <= 0) continue;
    const s = animate(npc);
    buf.push({
      kind: 'npc',
      y: s.position.y,
      entity: s,
      hasHealthBar: npc.behavior === 'aggressive',
    });
  }

  buf.sort((a, b) => a.y - b.y);

  for (const e of buf) renderEntity(e.entity);

  for (const e of buf) {
    if (e.kind === 'player') {
      renderHUD(e.entity);
    } else {
      if (e.hasHealthBar) renderHealthBar(e.entity);
      renderNpcLabel(e.entity, e.hasHealthBar);
    }
  }
}

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
