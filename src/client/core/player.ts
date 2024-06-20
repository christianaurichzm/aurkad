import { Player } from '../../shared/types';
import { keys } from '../io/keyboard';
import { socket } from '../io/network';

let _player: Player;

export const setPlayer = (player: Player) => {
  _player = player;
};

export const getPlayer = (): Player => {
  return _player;
};

export const update = (deltaTime: number) => {
  const player = getPlayer();

  if (player) {
    if (keys['ArrowUp']) player.y -= (player.speed * deltaTime) / 1000;
    if (keys['ArrowDown']) player.y += (player.speed * deltaTime) / 1000;
    if (keys['ArrowLeft']) player.x -= (player.speed * deltaTime) / 1000;
    if (keys['ArrowRight']) player.x += (player.speed * deltaTime) / 1000;

    if (keys['Shift'] && !keys['ShiftHandled']) {
      player.speed *= 4;
      keys['ShiftHandled'] = true;
    }
    if (!keys['Shift']) {
      player.speed = 50;
      keys['ShiftHandled'] = false;
    }

    if (keys['Control'] && !keys['ControlHandled']) {
      socket.send(JSON.stringify({ type: 'attack', player: player }));
      keys['ControlHandled'] = true;
    }

    if (!keys['Control']) {
      keys['ControlHandled'] = false;
    }

    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'playerUpdate', player: player }));
    }
  }
};
