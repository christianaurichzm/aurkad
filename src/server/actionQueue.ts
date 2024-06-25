import { ActionQueue, PlayerAction } from '../shared/types';
import { handleKeyPress, handleKeyRelease } from './gameService';

const actionQueue: ActionQueue = [];

export function enqueueAction(action: PlayerAction) {
  actionQueue.push(action);
}

export async function processActions() {
  while (true) {
    while (actionQueue.length > 0) {
      const action = actionQueue.shift();

      switch (action?.keyboardAction.type) {
        case 'press':
          handleKeyPress(action.username, action.keyboardAction.key);
          break;
        case 'release':
          handleKeyRelease(action.username, action.keyboardAction.key);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 / 60));
  }
}
