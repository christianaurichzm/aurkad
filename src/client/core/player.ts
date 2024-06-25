import { Key, PlayerAction } from '../../shared/types';
import { toggleTilesetEditor } from '../graphics/tileset';
import { openMapEditor, sendAction } from '../io/network';

function playerMove(direction: string, keyState: PlayerAction['keyState']) {
  const action: PlayerAction = {
    keyState,
    type: 'move',
    payload: {
      direction,
    },
  };
  sendAction(action);
}

function playerAttack(keyState: PlayerAction['keyState']) {
  const action: PlayerAction = {
    keyState,
    type: 'attack',
    payload: {},
  };
  sendAction(action);
}

function playerBoost(keyState: PlayerAction['keyState']) {
  const action: PlayerAction = {
    keyState,
    type: 'boost',
    payload: {
      boostType: 'speed',
    },
  };
  sendAction(action);
}

export const actionPlayer = (
  key: string,
  keyState: PlayerAction['keyState'],
) => {
  switch (key) {
    case Key.ArrowUp:
      playerMove('up', keyState);
      break;
    case Key.ArrowDown:
      playerMove('down', keyState);
      break;
    case Key.ArrowLeft:
      playerMove('left', keyState);
      break;
    case Key.ArrowRight:
      playerMove('right', keyState);
      break;
    case Key.Shift:
      playerBoost(keyState);
      break;
    case Key.Control:
      playerAttack(keyState);
      break;
    case Key.z:
      openMapEditor().then((res) => res && toggleTilesetEditor());
      break;
    default:
      break;
  }
};
