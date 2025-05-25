import {
  MOVEMENT_DURATION,
  RUN_MOVEMENT_DURATION,
  TILE_SIZE,
} from '../../shared/constants';
import {
  CharacterAction,
  Direction,
  PlayersMap,
  Position,
  DroppedItem,
  RuntimeNpcsMap,
  Player,
} from '../../shared/types';
import { getGameState, getPlayer } from '../core/gameState';
import { spriteSheet } from '../io/files';
import { renderHealthBar, renderHUD, updatePlayerHealthBar } from '../ui/hud';
import {
  foregroundCanvas,
  foregroundCtx,
  itemCanvas,
  itemCtx,
  playerCtx,
} from './canvas';
import { playerActionToActionColumnRecord } from '../../shared/mappings';
import { renderItemIcon } from './inventory';
import { getCharacterSpriteCoordinates, getSpriteSize } from './sprite';
import { mapEdited, renderMap } from './tileset';

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
interface MovementStep {
  from: Position;
  to: Position;
  startTime: number;
  duration: number;
}

const movementQueues = new Map<string, MovementStep[]>();

export function onServerPositionUpdate(
  playerId: string,
  from: Position,
  to: Position,
) {
  if (from.x === to.x && from.y === to.y) return;

  const queue = movementQueues.get(playerId) || [];
  const lastPos = queue.length > 0 ? queue[queue.length - 1].to : from;

  const gameState = getGameState();
  const clientPlayer = getPlayer();
  let playerState: Player | null = null;

  if (gameState?.players?.[playerId]) {
    playerState = gameState.players[playerId];
  } else if (clientPlayer?.id === playerId) {
    playerState = clientPlayer;
  }

  const isRunning = playerState?.action === CharacterAction.Run;
  const duration = isRunning ? RUN_MOVEMENT_DURATION : MOVEMENT_DURATION;

  queue.push({
    from: lastPos,
    to,
    startTime: performance.now(),
    duration: duration,
  });

  movementQueues.set(playerId, queue);
}

function getAnimatedPosition(playerId: string): Position {
  const queue = movementQueues.get(playerId);

  const gameState = getGameState();
  const localPlayer = getPlayer();
  let player: Player | null = null;
  if (gameState?.players?.[playerId]) {
    player = gameState.players[playerId];
  } else if (localPlayer?.id === playerId) {
    player = localPlayer;
  }

  if (!queue || queue.length === 0) {
    return player ? player.position : { x: 0, y: 0 };
  }

  const step = queue[0];
  const now = performance.now();
  const elapsed = now - step.startTime;
  const t = Math.min(elapsed / step.duration, 1);

  const x = step.from.x + (step.to.x - step.from.x) * t;
  const y = step.from.y + (step.to.y - step.from.y) * t;

  if (t >= 1) {
    queue.shift();
    movementQueues.set(playerId, queue);

    return step.to;
  }

  return { x, y };
}

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

const renderNpcs = (npcs: RuntimeNpcsMap) => {
  Object.values(npcs).forEach((npc) => {
    if (npc.health > 0) {
      renderEntity(npc);
      if (npc.behavior === 'aggressive') {
        renderHealthBar(npc);
      }
    }
  });
};

const renderDroppedItems = (droppedItems: DroppedItem[]) => {
  droppedItems.forEach((item) => {
    renderItemIcon(itemCtx, item.sprite, item.position.x, item.position.y);
  });
};

/**
 * Draws a sprite from the spritesheet onto any canvas context, at any
 * size and position.
 *
 * @param ctx The target CanvasRenderingContext2D
 * @param characterIndex Index of the sprite in the spritesheet
 * @param column Animation frame column (usually 0 for static previews)
 * @param row Animation frame row (usually 0 for static previews)
 * @param destX Destination X coordinate on the canvas
 * @param destY Destination Y coordinate on the canvas
 * @param destW Destination width (canvas.width for previews, SPRITE_WIDTH
 *   in play)
 * @param destH Destination height (canvas.height for previews,
 *   SPRITE_HEIGHT in play)
 */
export function drawSpriteGeneric(
  ctx: CanvasRenderingContext2D,
  characterIndex: number,
  column: number,
  row: number,
  destX: number,
  destY: number,
  destW: number,
  destH: number,
) {
  const { x, y } = getCharacterSpriteCoordinates(
    characterIndex,
    column,
    row,
    spriteSheet.naturalWidth,
  );
  const { SPRITE_WIDTH, SPRITE_HEIGHT } = getSpriteSize();

  ctx.drawImage(
    spriteSheet,
    x,
    y,
    SPRITE_WIDTH,
    SPRITE_HEIGHT,
    destX,
    destY,
    destW,
    destH,
  );
}

export function drawSprite(
  characterIndex: number,
  column: number,
  row: number,
  posX: number,
  posY: number,
) {
  const ctx = playerCtx;
  const { SPRITE_WIDTH, SPRITE_HEIGHT } = getSpriteSize();
  const offsetX = (TILE_SIZE - SPRITE_WIDTH) / 2;
  const offsetY = (TILE_SIZE - SPRITE_HEIGHT) / 2;

  drawSpriteGeneric(
    ctx,
    characterIndex,
    column,
    row,
    posX + offsetX,
    posY + offsetY,
    SPRITE_WIDTH,
    SPRITE_HEIGHT,
  );
}

export const render = () => {
  const map = getGameState();
  const currentPlayer = getPlayer();

  if (map) {
    const mapName = document.getElementById('mapName') as HTMLElement;
    mapName.textContent = `${map.id} - ${map.name}`;
    if (map.type === 'pvp') mapName.style.color = 'red';

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
    itemCtx.clearRect(0, 0, itemCanvas.width, itemCanvas.height);

    renderDroppedItems(map.droppedItems);

    renderPlayers(map.players);

    if (currentPlayer) {
      const smoothPosition = getAnimatedPosition(currentPlayer.id);

      const player = {
        ...currentPlayer,
        position: smoothPosition,
      };

      renderEntity(player);

      renderHUD(player);
      updatePlayerHealthBar(currentPlayer);
    }

    renderNpcs(map.npcs);
  }
};
