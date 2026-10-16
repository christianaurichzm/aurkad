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
import { drawSprite } from './spriteDrawing';
import { characterLayout, getSpriteLayout } from './sprite';
import { renderItemIcon } from './itemDrawing';
import { renderHUD, renderHealthBar, renderNpcLabel } from './hud';
import { worldToView, spritePosition } from './camera';
import { TILE_SIZE } from '../../shared/constants';
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
  width: number;
  height: number;
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
// A frame of a looping figure at rest (sprites.json `loop`): one cycle in about
// the time a step takes.
const IDLE_FRAME_MS = 180;

// A three-frame block (RPG Maker's layout) steps either side of standing.
const walkColumn = (sprite: number, step: number) =>
  characterLayout(sprite).columns === 3 && step === 3 ? 1 : step;

const animationColumn = (
  id: string,
  sprite: number,
  action: CharacterAction,
): number => {
  if (action !== CharacterAction.Walk && action !== CharacterAction.Run) {
    slideTById.delete(id);
    const layout = characterLayout(sprite);
    if (action === CharacterAction.Attack) return layout.attackColumn;
    return getSpriteLayout().characters[sprite]?.loop
      ? walkColumn(
          sprite,
          Math.floor(performance.now() / IDLE_FRAME_MS) % WALK_CYCLE_LENGTH,
        )
      : layout.idleColumn;
  }
  const slideT = slideTById.get(id) ?? 0;
  return walkColumn(
    sprite,
    Math.floor(slideT * WALK_CYCLE_LENGTH) % WALK_CYCLE_LENGTH,
  );
};

const renderEntity = (entity: SpriteEntity) => {
  drawSprite(
    entity.sprite,
    animationColumn(entity.id, entity.sprite, entity.action),
    entity.direction,
    entity.position.x,
    entity.position.y,
    entity.width,
    entity.height,
  );
};

// The behaviors combat lets a player hit (combat/index.ts): a fight the
// player can pick shows how it is going.
const fightable = (npc: RuntimeNpc): boolean =>
  npc.behavior === 'aggressive' || npc.behavior === 'hostile';

type PlayerEntry = { kind: 'player'; y: number; entity: PlayerPublic };
type NpcEntry = {
  kind: 'npc';
  y: number;
  entity: RuntimeNpc;
  hasHealthBar: boolean;
};
export type EntityHudEntry = PlayerEntry | NpcEntry;

// Draws players and npcs sorted by y, so lower ones draw in front. Labels
// come back in draw order for renderEntityHuds on the fringe layer, so no
// roof or treetop buries a name.
export function renderEntitiesSorted(
  players: PlayersMap,
  npcs: RuntimeNpcsMap,
  props: { y: number; draw: () => void }[] = [],
): EntityHudEntry[] {
  const buf: EntityHudEntry[] = [];

  for (const player of Object.values(players)) {
    const s = animate(player);
    buf.push({
      kind: 'player',
      y: worldToView(s.position.x + TILE_SIZE / 2, s.position.y + TILE_SIZE / 2)
        .y,
      entity: s,
    });
  }
  for (const npc of Object.values(npcs)) {
    if (npc.health <= 0) continue;
    const s = animate(npc);
    // A big npc is in front of what stands above its bottom row, not its top.
    buf.push({
      kind: 'npc',
      y: worldToView(
        s.position.x + npc.width / 2,
        s.position.y + npc.height - TILE_SIZE / 2,
      ).y,
      entity: s,
      hasHealthBar: fightable(npc),
    });
  }

  buf.sort((a, b) => a.y - b.y);
  const draws = [
    ...props,
    ...buf.map((e) => ({ y: e.y, draw: () => renderEntity(e.entity) })),
  ];
  draws.sort((a, b) => a.y - b.y);
  for (const entry of draws) entry.draw();

  return buf;
}

// Names, tags, bubbles and npc health bars, always on top. A monster's
// name shows only once the pointer has found it (`named`).
export function renderEntityHuds(
  entries: EntityHudEntry[],
  ctx: CanvasRenderingContext2D,
  named: ReadonlySet<string> = new Set(),
): void {
  for (const e of entries) {
    if (e.kind === 'player') {
      renderHUD(e.entity, ctx);
    } else {
      if (e.hasHealthBar) renderHealthBar(e.entity, ctx);
      if (!e.hasHealthBar || named.has(e.entity.id))
        renderNpcLabel(e.entity, e.hasHealthBar, ctx);
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

export const renderDroppedItems = (droppedItems: DroppedItem[]) => {
  droppedItems.forEach((item) => {
    const at = spritePosition(item.position.x, item.position.y);
    renderItemIcon(itemCtx, item.sprite, at.x, at.y, false);
  });
};
