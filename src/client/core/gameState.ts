import { MapStateClient, Player } from '../../shared/types';
import * as jsondiffpatch from 'jsondiffpatch';

interface FullGameState {
  map: MapStateClient;
  player: Player;
}

const diffPatcher = jsondiffpatch.create({
  objectHash: (obj: any, index?: number): string | undefined => {
    return obj.id || obj.name || `$$index:${index}`;
  },
  arrays: {
    detectMove: true,
    includeValueOnMove: false,
  },
});

let fullGameState: FullGameState | null = null;

export const getPlayer = (): Player | null => {
  return fullGameState?.player ?? null;
};

export const getGameState = (): MapStateClient | null => {
  return fullGameState?.map ?? null;
};

export const setFullGameState = (payload: FullGameState) => {
  console.log('Setting Full Game State...');
  fullGameState = payload;
};

export const patchGameState = (delta: jsondiffpatch.Delta | undefined) => {
  if (fullGameState && delta) {
    console.log('Patching Game State Delta:', delta);
    fullGameState = diffPatcher.patch(
      fullGameState,
      delta,
    ) as unknown as FullGameState;
  } else if (!fullGameState) {
    console.warn('Attempted to patch but no full game state exists.');
  } else if (!delta) {
    console.warn('Received a delta message but the delta was undefined.');
  }
};
