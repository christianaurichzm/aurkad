import type { MapStateClient, Player } from '../../shared/types';
import type { FullGameStatePayload } from '../../shared/wsProtocol';
import * as jsondiffpatch from 'jsondiffpatch';

const diffPatcher = jsondiffpatch.create({
  objectHash: (obj: any, index?: number): string | undefined => {
    return obj.id || obj.name || `$$index:${index}`;
  },
  arrays: {
    detectMove: true,
    includeValueOnMove: false,
  },
});

let fullGameState: FullGameStatePayload | null = null;

export const getPlayer = (): Player | null => {
  return fullGameState?.player ?? null;
};

export const getGameState = (): MapStateClient | null => {
  return fullGameState?.map ?? null;
};

export const setFullGameState = (payload: FullGameStatePayload) => {
  fullGameState = payload;
};

export const patchGameState = (delta: jsondiffpatch.Delta | undefined) => {
  if (fullGameState && delta) {
    fullGameState = diffPatcher.patch(
      fullGameState,
      delta,
    ) as unknown as FullGameStatePayload;
  } else if (!fullGameState) {
    console.warn('Attempted to patch but no full game state exists.');
  } else if (!delta) {
    console.warn('Received a delta message but the delta was undefined.');
  }
};
